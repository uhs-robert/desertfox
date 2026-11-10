import assert from "node:assert/strict";
import { test } from "node:test";
import { create_display_host, FIRST_RETRY_MS, FULLSCREEN_POLL_MS, MAX_RETRY_MS, STABLE_MS } from "../../src/background/display_host.ts";
import type { DisplayDeps, DisplayPort, DisplayWindow } from "../../src/background/display_host.ts";
import { badge_hidden } from "../../src/background/display_ui.ts";
import type { Mode } from "../../src/shared/command.ts";
import type { WhichKeyPanel } from "../../src/shared/messages.ts";

const PANEL: WhichKeyPanel = { title: ["+Go"], border: "square", rows: [{ keys: "gt", command: "Next tab", description: "", more: false }] };

function make(options: { ui?: "browser" | "quickshell"; mode_indicator?: "always" | "not_normal" | "off"; missing_host?: boolean } = {}) {
  const settings = { ui: options.ui ?? "quickshell", mode_indicator: options.mode_indicator ?? "always" };
  const windows = new Map<number, DisplayWindow>([[1, { id: 1, focused: true, fullscreen: false, private: false }], [2, { id: 2, focused: false, fullscreen: false, private: false }]]);
  const active_tab = new Map<number, number>([[1, 11], [2, 22]]);
  const modes = new Map<number, Mode>();
  let last_focused = 1;
  const ports: (DisplayPort & { posted: Record<string, unknown>[]; disconnected: boolean; say: () => void; drop: () => void; throw_on_post: boolean })[] = [];
  const timers: { run: () => void; delay_ms: number; cancelled: boolean }[] = [];
  const counts = { connects: 0, refreshes: 0 };
  let now = 0;
  const deps: DisplayDeps = {
    connect: () => {
      counts.connects++;
      if (options.missing_host) throw new Error("No such native application desertfox_display_host");
      let on_message: (message: unknown) => void = () => {};
      let on_disconnect: () => void = () => {};
      const port = {
        posted: [] as Record<string, unknown>[],
        disconnected: false,
        throw_on_post: false,
        postMessage(message: object) {
          if (port.throw_on_post) throw new Error("port closed");
          port.posted.push(message as Record<string, unknown>);
        },
        disconnect() {
          port.disconnected = true;
        },
        onMessage: { addListener: (listener: (message: unknown) => void) => void (on_message = listener) },
        onDisconnect: { addListener: (listener: () => void) => void (on_disconnect = listener) },
        say: () => on_message({ ready: true }),
        drop: () => on_disconnect(),
      };
      ports.push(port);
      return port;
    },
    read_settings: async () => ({ ...settings }),
    last_focused_window: async () => windows.get(last_focused),
    window_of: async (id) => windows.get(id),
    active_tab_of: async (id) => active_tab.get(id),
    recall_mode: async (tab_id) => modes.get(tab_id) ?? "normal",
    refresh_pages: async () => void counts.refreshes++,
    after: (run, delay_ms) => {
      const timer = { run, delay_ms, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
    now_ms: () => now,
  };
  const display = create_display_host(deps);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  const pending = () => timers.filter((timer) => !timer.cancelled);
  return {
    display, settings, windows, active_tab, modes, ports, timers, counts, settle,
    port: () => ports[ports.length - 1]!,
    advance: (ms: number) => void (now += ms),
    set_last_focused: (id: number) => void (last_focused = id),
    // Fires the newest pending timer and returns its delay.
    fire_latest: () => {
      const timer = pending().at(-1)!;
      timer.cancelled = true;
      timer.run();
      return timer.delay_ms;
    },
    pending_delays: () => pending().map((timer) => timer.delay_ms),
    connect_and_ready: async () => {
      await display.start();
      ports[ports.length - 1]!.say();
      await settle();
    },
  };
}

const modes_posted = (port: { posted: Record<string, unknown>[] }) => port.posted.filter((message) => message.verb === "mode");

test("with ui browser nothing connects and the in-page UI stays on", async () => {
  const test_case = make({ ui: "browser" });
  await test_case.display.start();
  assert.equal(test_case.counts.connects, 0);
  assert.equal(badge_hidden(), false);
  assert.equal(test_case.display.whichkey_panel(PANEL, { id: 11, active: true }), PANEL);
});

test("the in-page UI stays on until the host says it is ready, so a missing host flashes nothing", async () => {
  const test_case = make();
  await test_case.display.start();
  assert.equal(test_case.counts.connects, 1);
  assert.equal(badge_hidden(), false);
  assert.equal(test_case.display.whichkey_panel(PANEL, { id: 11, active: true }), PANEL);
  assert.deepEqual(test_case.port().posted, []);
  const refreshes = test_case.counts.refreshes;
  test_case.port().drop();
  assert.equal(test_case.counts.refreshes, refreshes);
  assert.equal(badge_hidden(), false);
});

test("once ready the host gets a full snapshot and the in-page badge and panel go off", async () => {
  const test_case = make();
  test_case.modes.set(11, "insert");
  await test_case.connect_and_ready();
  assert.deepEqual(test_case.port().posted, [{ verb: "mode", id: "insert", label: "INSERT", tab_id: 11, window_id: 1, fullscreen: false, private: false }]);
  assert.equal(badge_hidden(), true);
  assert.equal(test_case.counts.refreshes, 2);
  const answer = test_case.display.whichkey_panel(PANEL, { id: 11, active: true });
  assert.equal(answer.external, true);
  assert.deepEqual(test_case.port().posted.at(-1), { verb: "whichkey_show", title: ["+Go"], border: "square", rows: PANEL.rows });
});

test("the label follows mode_indicator and is empty for modes with no label", async () => {
  const hidden_normal = make({ mode_indicator: "not_normal" });
  await hidden_normal.connect_and_ready();
  assert.equal(modes_posted(hidden_normal.port())[0]!.label, "");
  const off = make({ mode_indicator: "off" });
  off.modes.set(11, "insert");
  await off.connect_and_ready();
  assert.equal(modes_posted(off.port())[0]!.label, "");
  const hint = make();
  hint.modes.set(11, "hint");
  await hint.connect_and_ready();
  assert.equal(modes_posted(hint.port())[0]!.label, "");
  assert.equal(modes_posted(hint.port())[0]!.id, "hint");
});

test("publish points: mode change of the active tab, window focus, tab activation", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  port.posted.length = 0;
  await test_case.display.mode_changed({ id: 11, windowId: 1, active: true }, "visual");
  assert.deepEqual(port.posted, [{ verb: "mode", id: "visual", label: "VISUAL", tab_id: 11, window_id: 1, fullscreen: false, private: false }]);
  port.posted.length = 0;
  test_case.windows.set(2, { id: 2, focused: true, fullscreen: false, private: true });
  test_case.windows.set(1, { id: 1, focused: false, fullscreen: false, private: false });
  test_case.modes.set(22, "insert");
  await test_case.display.window_focused(2);
  assert.deepEqual(port.posted, [{ verb: "mode", id: "insert", label: "INSERT", tab_id: 22, window_id: 2, fullscreen: false, private: true }]);
  port.posted.length = 0;
  test_case.active_tab.set(2, 23);
  await test_case.display.tab_activated(2);
  assert.deepEqual(port.posted, [{ verb: "mode", id: "normal", label: "NORMAL", tab_id: 23, window_id: 2, fullscreen: false, private: true }]);
});

test("nothing is published for a background tab, an unfocused window or no window", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  port.posted.length = 0;
  await test_case.display.mode_changed({ id: 12, windowId: 1, active: false }, "insert");
  await test_case.display.mode_changed({ id: 22, windowId: 2, active: true }, "insert");
  await test_case.display.mode_changed({ id: undefined, windowId: 1, active: true }, "insert");
  await test_case.display.window_focused(-1);
  await test_case.display.window_focused(2);
  await test_case.display.tab_activated(2);
  assert.deepEqual(port.posted, []);
});

test("a fullscreen change of the focused window publishes, brings the in-page badge back and tells the pages", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  port.posted.length = 0;
  const refreshes = test_case.counts.refreshes;
  test_case.windows.set(1, { id: 1, focused: true, fullscreen: true, private: false });
  assert.equal(test_case.fire_latest(), FULLSCREEN_POLL_MS);
  await test_case.settle();
  assert.equal(modes_posted(port).length, 1);
  assert.equal(modes_posted(port)[0]!.fullscreen, true);
  assert.equal(badge_hidden(), false);
  assert.equal(test_case.counts.refreshes, refreshes + 1);
  // No change, no publish and no page refresh.
  port.posted.length = 0;
  test_case.fire_latest();
  await test_case.settle();
  assert.deepEqual(port.posted, []);
  assert.equal(test_case.counts.refreshes, refreshes + 1);
  test_case.windows.set(1, { id: 1, focused: true, fullscreen: false, private: false });
  test_case.fire_latest();
  await test_case.settle();
  assert.equal(badge_hidden(), true);
  assert.equal(modes_posted(port)[0]!.fullscreen, false);
});

test("a fullscreen change in an unfocused window publishes nothing", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().posted.length = 0;
  test_case.windows.set(1, { id: 1, focused: false, fullscreen: true, private: false });
  test_case.fire_latest();
  await test_case.settle();
  assert.deepEqual(test_case.port().posted, []);
  assert.equal(badge_hidden(), true);
});

test("which-key hide is published once, on the page's word, on a tab or window switch and when its tab goes", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  const verbs = () => port.posted.map((message) => message.verb);
  port.posted.length = 0;
  test_case.display.whichkey_panel(PANEL, { id: 11, active: true });
  test_case.display.whichkey_hidden();
  test_case.display.whichkey_hidden();
  assert.deepEqual(verbs(), ["whichkey_show", "whichkey_hide"]);
  port.posted.length = 0;
  test_case.display.whichkey_panel(PANEL, { id: 11, active: true });
  await test_case.display.tab_activated(1);
  assert.deepEqual(verbs(), ["whichkey_show", "whichkey_hide", "mode"]);
  port.posted.length = 0;
  test_case.display.whichkey_panel(PANEL, { id: 11, active: true });
  test_case.display.tab_gone(99);
  test_case.display.tab_gone(11);
  assert.deepEqual(verbs(), ["whichkey_show", "whichkey_hide"]);
  port.posted.length = 0;
  test_case.display.whichkey_panel(PANEL, { id: 11, active: true });
  test_case.display.whichkey_panel({ ...PANEL, rows: [] }, { id: 11, active: true });
  assert.deepEqual(verbs(), ["whichkey_show", "whichkey_hide"]);
  port.posted.length = 0;
  assert.equal(test_case.display.whichkey_panel(PANEL, { id: 12, active: false }).external, undefined);
  assert.deepEqual(port.posted, []);
});

test("a dropped port gives the in-page UI back and reconnects with a growing pause, never in a tight loop", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().drop();
  assert.equal(badge_hidden(), false);
  assert.equal(test_case.display.whichkey_panel(PANEL, { id: 11, active: true }), PANEL);
  const delays: number[] = [];
  for (let round = 0; round < 9; round++) {
    delays.push(test_case.fire_latest());
    assert.equal(test_case.ports.length, round + 2);
    test_case.port().drop();
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.ok(delays.every((delay) => delay >= FIRST_RETRY_MS && delay <= MAX_RETRY_MS));
  assert.equal(test_case.pending_delays().length, 1);
});

test("a missing host retries with backoff and the in-page UI stays on", async () => {
  const test_case = make({ missing_host: true });
  await test_case.display.start();
  assert.equal(badge_hidden(), false);
  const delays = [test_case.pending_delays()[0]!];
  for (let round = 0; round < 3; round++) {
    test_case.fire_latest();
    delays.push(test_case.pending_delays().at(-1)!);
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  assert.equal(test_case.display.whichkey_panel(PANEL, { id: 11, active: true }), PANEL);
});

test("a port that stayed up long enough starts the backoff over", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().drop();
  test_case.fire_latest();
  test_case.port().say();
  await test_case.settle();
  test_case.advance(STABLE_MS);
  test_case.port().drop();
  assert.equal(test_case.pending_delays().at(-1), FIRST_RETRY_MS);
});

test("after a reconnect the host gets the mode now, not the one from before the drop", async () => {
  const test_case = make();
  test_case.modes.set(11, "normal");
  await test_case.connect_and_ready();
  test_case.port().drop();
  // Sent while the port is down: this must not be lost in a way that leaves the old mode in the file.
  test_case.modes.set(11, "insert");
  await test_case.display.mode_changed({ id: 11, windowId: 1, active: true }, "insert");
  test_case.fire_latest();
  const second = test_case.port();
  assert.deepEqual(second.posted, []);
  second.say();
  await test_case.settle();
  assert.deepEqual(second.posted, [{ verb: "mode", id: "insert", label: "INSERT", tab_id: 11, window_id: 1, fullscreen: false, private: false }]);
  assert.equal(badge_hidden(), true);
});

test("a port that throws on send counts as dropped", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().throw_on_post = true;
  await test_case.display.mode_changed({ id: 11, windowId: 1, active: true }, "insert");
  assert.equal(badge_hidden(), false);
  assert.equal(test_case.pending_delays().at(-1), FIRST_RETRY_MS);
});

test("an old port that reports late does not disturb the new one", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const old = test_case.port();
  old.drop();
  test_case.fire_latest();
  test_case.port().say();
  await test_case.settle();
  old.drop();
  assert.equal(badge_hidden(), true);
});

test("changing ui to browser closes the port and stops retrying, and back to quickshell connects again", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  test_case.settings.ui = "browser";
  await test_case.display.settings_changed();
  assert.equal(port.disconnected, true);
  assert.equal(badge_hidden(), false);
  assert.deepEqual(test_case.pending_delays().filter((delay) => delay !== FULLSCREEN_POLL_MS), []);
  test_case.settings.ui = "quickshell";
  await test_case.display.settings_changed();
  assert.equal(test_case.ports.length, 2);
});
