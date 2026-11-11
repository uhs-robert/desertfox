import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bridge, FIRST_RETRY_MS, MAX_RETRY_MS, STABLE_MS } from "../../src/background/bridge.ts";
import type { BridgeDeps, BridgePort, BridgeWindow } from "../../src/background/bridge.ts";
import type { Mode } from "../../src/shared/command.ts";
import type { BridgeAnswer } from "../../src/background/bridge_run.ts";
import type { TabInfo } from "../../src/background/tab_switch.ts";

function make(options: { bridge?: boolean; missing_host?: boolean; permission?: boolean; run_command?: (text: string, tab_id?: number) => Promise<BridgeAnswer>; share_tabs?: boolean; tab_verb?: BridgeDeps["tab_verb"] } = {}) {
  const settings = { bridge: options.bridge ?? true, share_tabs: options.share_tabs ?? false };
  const tab_calls: { verb: string; request: Record<string, unknown> }[] = [];
  const state = { permission: options.permission ?? true, gate: undefined as Promise<void> | undefined };
  const windows = new Map<number, BridgeWindow>([[1, { id: 1, focused: true, private: false }], [2, { id: 2, focused: false, private: false }]]);
  const active_tab = new Map<number, number>([[1, 11], [2, 22]]);
  const modes = new Map<number, Mode>();
  // The tabs `normal_tab` finds. Any other id stands for a private or popup tab.
  const normal_tabs = new Map<number, TabInfo>([[11, { id: 11, windowId: 1, title: "Mail", url: "https://mail.example/" }], [22, { id: 22, windowId: 2, title: "Music", url: "https://music.example/" }]]);
  const ports: (BridgePort & { posted: Record<string, unknown>[]; disconnected: boolean; say: () => void; hear: (message: unknown) => void; drop: () => void; throw_on_post: boolean })[] = [];
  const timers: { run: () => void; delay_ms: number; cancelled: boolean }[] = [];
  const counts = { connects: 0 };
  let now = 0;
  const deps: BridgeDeps = {
    connect: () => {
      counts.connects++;
      if (options.missing_host) throw new Error("No such native application desertfox_bridge");
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
        hear: (message: unknown) => on_message(message),
        drop: () => on_disconnect(),
      };
      ports.push(port);
      return port;
    },
    read_settings: async () => ({ ...settings }),
    permission_granted: async () => {
      await state.gate;
      return state.permission;
    },
    last_focused_window: async () => [...windows.values()].find((window) => window.focused),
    window_of: async (id) => windows.get(id),
    active_tab_of: async (id) => active_tab.get(id),
    recall_mode: async (tab_id) => modes.get(tab_id) ?? "normal",
    after: (run, delay_ms) => {
      const timer = { run, delay_ms, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
    now_ms: () => now,
    run_command: options.run_command ?? (async () => ({ ok: true })),
    list_commands: () => [{ id: "tab.next", label: "Next tab", intent: "Go to the next tab." }],
    tab_verb: options.tab_verb ?? (async (verb, request) => {
      tab_calls.push({ verb, request });
      return { ok: true, handled: verb };
    }),
    normal_tab: async (tab_id) => normal_tabs.get(tab_id),
  };
  const bridge = create_bridge(deps);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  const pending = () => timers.filter((timer) => !timer.cancelled);
  return {
    bridge, settings, state, windows, active_tab, modes, normal_tabs, ports, counts, settle, tab_calls, timers,
    port: () => ports[ports.length - 1]!,
    advance: (ms: number) => void (now += ms),
    // Fires the newest pending timer, lets the connect it starts finish and returns its delay.
    fire_latest: async () => {
      const timer = pending().at(-1)!;
      timer.cancelled = true;
      timer.run();
      await settle();
      return timer.delay_ms;
    },
    pending_delays: () => pending().map((timer) => timer.delay_ms),
    connect_and_ready: async () => {
      await bridge.start();
      ports[ports.length - 1]!.say();
      await settle();
    },
  };
}

// With sharing off every ready also sends `tabs_off`, so the tests of the mode read only the mode messages.
const modes_of = (port: { posted: Record<string, unknown>[] }) => port.posted.filter((message) => message.verb === "mode");

const NORMAL_MESSAGE = { verb: "mode", id: "normal", label: "NORMAL", private: false, tab_id: 11, window_id: 1 };

test("with bridge off nothing connects", async () => {
  const test_case = make({ bridge: false });
  await test_case.bridge.start();
  assert.equal(test_case.counts.connects, 0);
  assert.deepEqual(test_case.pending_delays(), []);
});

test("nothing is sent until the host says it is ready", async () => {
  const test_case = make();
  await test_case.bridge.start();
  assert.equal(test_case.counts.connects, 1);
  await test_case.bridge.mode_changed({ id: 11, windowId: 1, active: true }, "insert");
  assert.deepEqual(test_case.port().posted, []);
  test_case.port().say();
  await test_case.settle();
  assert.equal(modes_of(test_case.port()).length, 1);
});

test("once ready the host gets a full snapshot", async () => {
  const test_case = make();
  test_case.modes.set(11, "insert");
  await test_case.connect_and_ready();
  assert.deepEqual(modes_of(test_case.port()), [{ ...NORMAL_MESSAGE, id: "insert", label: "INSERT" }]);
});

test("a private window sends its mode and the private flag and no id", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  port.posted.length = 0;
  test_case.windows.set(2, { id: 2, focused: true, private: true });
  test_case.windows.set(1, { id: 1, focused: false, private: false });
  test_case.modes.set(22, "insert");
  await test_case.bridge.window_focused(2);
  await test_case.bridge.mode_changed({ id: 22, windowId: 2, active: true }, "visual");
  test_case.active_tab.set(2, 23);
  await test_case.bridge.tab_activated(2, 23);
  assert.deepEqual(port.posted, [
    { verb: "mode", id: "insert", label: "INSERT", private: true },
    { verb: "mode", id: "visual", label: "VISUAL", private: true },
    { verb: "mode", id: "normal", label: "NORMAL", private: true },
  ]);
});

test("the label is empty only for modes with no label, whatever mode_indicator says", async () => {
  const hint = make();
  hint.modes.set(11, "hint");
  await hint.connect_and_ready();
  assert.equal(modes_of(hint.port())[0]!.label, "");
  assert.equal(modes_of(hint.port())[0]!.id, "hint");
  const visual = make();
  visual.modes.set(11, "visual");
  await visual.connect_and_ready();
  assert.equal(modes_of(visual.port())[0]!.label, "VISUAL");
});

test("publish points: mode change of the active tab, window focus, tab activation", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  port.posted.length = 0;
  await test_case.bridge.mode_changed({ id: 11, windowId: 1, active: true }, "visual");
  assert.deepEqual(port.posted, [{ ...NORMAL_MESSAGE, id: "visual", label: "VISUAL" }]);
  port.posted.length = 0;
  test_case.windows.set(2, { id: 2, focused: true, private: false });
  test_case.windows.set(1, { id: 1, focused: false, private: false });
  test_case.modes.set(22, "insert");
  await test_case.bridge.window_focused(2);
  assert.deepEqual(port.posted, [{ ...NORMAL_MESSAGE, id: "insert", label: "INSERT", tab_id: 22, window_id: 2 }]);
  port.posted.length = 0;
  test_case.active_tab.set(2, 23);
  await test_case.bridge.tab_activated(2, 23);
  assert.deepEqual(port.posted, [{ ...NORMAL_MESSAGE, tab_id: 23, window_id: 2 }]);
});

test("nothing is published for a background tab, an unfocused window or no window", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  port.posted.length = 0;
  await test_case.bridge.mode_changed({ id: 12, windowId: 1, active: false }, "insert");
  await test_case.bridge.mode_changed({ id: 22, windowId: 2, active: true }, "insert");
  await test_case.bridge.mode_changed({ id: undefined, windowId: 1, active: true }, "insert");
  await test_case.bridge.window_focused(-1);
  await test_case.bridge.window_focused(2);
  await test_case.bridge.tab_activated(2, 22);
  assert.deepEqual(port.posted, []);
});

test("a dropped port reconnects with a growing pause, never in a tight loop", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().drop();
  const delays: number[] = [];
  for (let round = 0; round < 9; round++) {
    delays.push(await test_case.fire_latest());
    assert.equal(test_case.ports.length, round + 2);
    test_case.port().drop();
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.ok(delays.every((delay) => delay >= FIRST_RETRY_MS && delay <= MAX_RETRY_MS));
  assert.equal(test_case.pending_delays().length, 1);
});

test("a host that dies while the extension runs is replaced by a reconnect that sends the state again", async () => {
  const test_case = make();
  test_case.modes.set(11, "insert");
  await test_case.connect_and_ready();
  test_case.advance(60_000);
  test_case.port().drop();
  assert.deepEqual(test_case.pending_delays(), [FIRST_RETRY_MS]);
  await test_case.fire_latest();
  test_case.port().say();
  await test_case.settle();
  assert.deepEqual(modes_of(test_case.port()), [{ ...NORMAL_MESSAGE, id: "insert", label: "INSERT" }]);
});

test("a missing host retries with backoff", async () => {
  const test_case = make({ missing_host: true });
  await test_case.bridge.start();
  const delays = [test_case.pending_delays()[0]!];
  for (let round = 0; round < 3; round++) {
    await test_case.fire_latest();
    delays.push(test_case.pending_delays().at(-1)!);
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
});

test("a second host that waits for the lock and exits is a drop before ready and backs off", async () => {
  const test_case = make();
  await test_case.bridge.start();
  test_case.port().drop();
  assert.deepEqual(test_case.pending_delays(), [FIRST_RETRY_MS]);
  await test_case.fire_latest();
  test_case.port().drop();
  assert.deepEqual(test_case.pending_delays(), [2 * FIRST_RETRY_MS]);
});

test("a port that stayed up long enough starts the backoff over", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().drop();
  await test_case.fire_latest();
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
  test_case.modes.set(11, "insert");
  await test_case.bridge.mode_changed({ id: 11, windowId: 1, active: true }, "insert");
  await test_case.fire_latest();
  const second = test_case.port();
  assert.deepEqual(second.posted, []);
  second.say();
  await test_case.settle();
  assert.deepEqual(modes_of(second), [{ ...NORMAL_MESSAGE, id: "insert", label: "INSERT" }]);
});

test("a port that throws on send counts as dropped", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().throw_on_post = true;
  await test_case.bridge.mode_changed({ id: 11, windowId: 1, active: true }, "insert");
  assert.equal(test_case.pending_delays().at(-1), FIRST_RETRY_MS);
});

test("an old port that reports late does not disturb the new one", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const old = test_case.port();
  old.drop();
  await test_case.fire_latest();
  test_case.port().say();
  await test_case.settle();
  old.drop();
  assert.deepEqual(test_case.pending_delays(), []);
  assert.equal(test_case.ports.length, 2);
});

test("turning bridge off closes the port and stops retrying, and on again connects", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  const port = test_case.port();
  test_case.settings.bridge = false;
  await test_case.bridge.settings_changed();
  assert.equal(port.disconnected, true);
  assert.deepEqual(test_case.pending_delays(), []);
  test_case.settings.bridge = true;
  await test_case.bridge.settings_changed();
  assert.equal(test_case.ports.length, 2);
});

test("without the permission no port opens, and granting it connects at once", async () => {
  const test_case = make({ permission: false });
  await test_case.bridge.start();
  assert.equal(test_case.counts.connects, 0);
  assert.deepEqual(test_case.pending_delays(), [FIRST_RETRY_MS]);
  test_case.state.permission = true;
  test_case.bridge.permission_added();
  await test_case.settle();
  assert.equal(test_case.counts.connects, 1);
  assert.deepEqual(test_case.pending_delays(), []);
});

test("overlapping connects open one port, not two", async () => {
  const test_case = make();
  let release: () => void = () => {};
  test_case.state.gate = new Promise<void>((resolve) => void (release = resolve));
  const starting = test_case.bridge.start();
  test_case.bridge.permission_added();
  test_case.bridge.permission_added();
  release();
  await starting;
  await test_case.settle();
  assert.equal(test_case.counts.connects, 1);
  assert.equal(test_case.ports.length, 1);
});

const replies_of = (port: { posted: Record<string, unknown>[] }) => port.posted.filter((message) => message.verb === "reply");

test("a run request from the host is answered with its own request id", async () => {
  const seen: string[] = [];
  const test_case = make({ run_command: async (text) => (seen.push(text), { ok: true }) });
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "run", request_id: 7, command: "tab.next" });
  await test_case.settle();
  assert.deepEqual(seen, ["tab.next"]);
  assert.deepEqual(replies_of(test_case.port()), [{ verb: "reply", request_id: 7, ok: true }]);
});

test("a refusal comes back as ok false with its message, and a throw does too", async () => {
  const test_case = make({
    run_command: async (text) => {
      if (text === "boom") throw new Error("handler broke on tab Bank");
      return { ok: false, message: "refused" };
    },
  });
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "run", request_id: 1, command: "x" });
  test_case.port().hear({ verb: "run", request_id: 2, command: "boom" });
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()), [
    { verb: "reply", request_id: 1, ok: false, message: "refused" },
    { verb: "reply", request_id: 2, ok: false, message: "the command failed" },
  ]);
});

test("list answers with the commands the bridge offers", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "list", request_id: 3 });
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()), [{ verb: "reply", request_id: 3, ok: true, commands: [{ id: "tab.next", label: "Next tab", intent: "Go to the next tab." }] }]);
});

test("two requests at once are answered in the order they finish, each with its own id", async () => {
  const gates = new Map<string, () => void>();
  const test_case = make({ run_command: (text) => new Promise((resolve) => gates.set(text, () => resolve({ ok: true }))) });
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "run", request_id: 1, command: "slow" });
  test_case.port().hear({ verb: "run", request_id: 2, command: "fast" });
  await test_case.settle();
  gates.get("fast")!();
  await test_case.settle();
  gates.get("slow")!();
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()).map((reply) => reply.request_id), [2, 1]);
});

test("a malformed or unknown request from the host gets no answer and does not break the port", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  for (const message of [null, "x", { verb: "run", request_id: "1", command: "a" }, { verb: "run", request_id: 1 }, { verb: "shell", request_id: 1, command: "a" }, { verb: "mode", request_id: 1 }]) test_case.port().hear(message);
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()), []);
  test_case.port().hear({ verb: "list", request_id: 9 });
  await test_case.settle();
  assert.equal(replies_of(test_case.port()).length, 1);
});

test("a command text over the cap is refused without reaching the runner", async () => {
  const test_case = make({ run_command: async () => assert.fail("must not run") });
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "run", request_id: 1, command: "x".repeat(5000) });
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()), [{ verb: "reply", request_id: 1, ok: false, message: "the command text is too long" }]);
});

test("a request before the host is ready gets no answer, and a message that is not the ready one does not open the port", async () => {
  const test_case = make();
  await test_case.bridge.start();
  test_case.port().hear({ verb: "run", request_id: 1, command: "tab.next" });
  await test_case.settle();
  assert.deepEqual(test_case.port().posted, []);
  test_case.port().say();
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()), []);
});

test("a run that finishes after the port dropped is not sent, not even to the next port", async () => {
  let release: () => void = () => {};
  const test_case = make({ run_command: () => new Promise((resolve) => (release = () => resolve({ ok: true }))) });
  await test_case.connect_and_ready();
  const first = test_case.port();
  first.hear({ verb: "run", request_id: 1, command: "tab.next" });
  await test_case.settle();
  first.drop();
  await test_case.fire_latest();
  test_case.port().say();
  await test_case.settle();
  const second = test_case.port();
  assert.notEqual(first, second);
  release();
  await test_case.settle();
  assert.deepEqual(replies_of(first), []);
  assert.deepEqual(replies_of(second), []);
});

test("the tab verbs and a run with a tab id answer that sharing is off until bridge_share_tabs is on", async () => {
  const test_case = make({ run_command: async () => assert.fail("must not run") });
  await test_case.connect_and_ready();
  for (const [index, verb] of ["tabs", "activate", "clear_preface", "close", "capture"].entries()) test_case.port().hear({ verb, request_id: index + 1, tab_id: 5 });
  test_case.port().hear({ verb: "run", request_id: 9, command: "tab.next", tab_id: 5 });
  await test_case.settle();
  const replies = replies_of(test_case.port());
  assert.equal(replies.length, 6);
  for (const reply of replies) assert.deepEqual({ ok: reply.ok, message: reply.message }, { ok: false, message: "tab sharing is off, set bridge_share_tabs to true" });
  assert.deepEqual(test_case.tab_calls, []);
});

test("with bridge_share_tabs on the tab verbs reach the tab handler and a run carries its tab id", async () => {
  const runs: [string, number | undefined][] = [];
  const test_case = make({ share_tabs: true, run_command: async (text, tab_id) => (runs.push([text, tab_id]), { ok: true }) });
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "activate", request_id: 1, tab_id: 5, preface: "abc" });
  test_case.port().hear({ verb: "run", request_id: 2, command: "tab.next", tab_id: 5 });
  test_case.port().hear({ verb: "run", request_id: 3, command: "tab.next" });
  await test_case.settle();
  assert.deepEqual(test_case.tab_calls.map((call) => [call.verb, call.request.tab_id, call.request.preface]), [["activate", 5, "abc"]]);
  assert.deepEqual(runs, [["tab.next", 5], ["tab.next", undefined]]);
  assert.deepEqual(replies_of(test_case.port()).map((reply) => reply.ok), [true, true, true]);
});

test("a run whose tab id is not a whole number gets no answer, and the opt-in follows a settings change", async () => {
  const test_case = make({ share_tabs: true });
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "run", request_id: 1, command: "tab.next", tab_id: "5" });
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()), []);
  test_case.settings.share_tabs = false;
  await test_case.bridge.settings_changed();
  test_case.port().hear({ verb: "tabs", request_id: 2 });
  await test_case.settle();
  assert.equal(replies_of(test_case.port())[0]!.ok, false);
});

test("tab events go up the port only once the host is ready and while bridge_share_tabs is on", async () => {
  const test_case = make({ share_tabs: true });
  await test_case.bridge.start();
  test_case.bridge.tab_updated(11, { audible: true });
  await test_case.settle();
  assert.deepEqual(test_case.port().posted, [], "nothing before ready");
  test_case.port().say();
  await test_case.settle();
  test_case.port().posted.length = 0;
  test_case.bridge.tab_updated(11, { audible: true });
  await test_case.bridge.tab_activated(1, 11);
  await test_case.settle();
  // The mode and the tab events run in separate queues, so their order is not fixed.
  assert.deepEqual(new Set(test_case.port().posted.map((message) => JSON.stringify(message))), new Set([
    { verb: "event", event: "tab_audible", tab_id: 11, window_id: 1, audible: true, title: "Mail", url: "https://mail.example/" },
    { verb: "event", event: "tab_activated", tab_id: 11, window_id: 1 },
    NORMAL_MESSAGE,
  ].map((message) => JSON.stringify(message))));
  const off = make();
  await off.connect_and_ready();
  off.port().posted.length = 0;
  off.bridge.tab_updated(11, { audible: true, title: "x" });
  await off.bridge.tab_activated(1, 11);
  off.bridge.tab_removed(11);
  await off.settle();
  assert.deepEqual(off.port().posted, [NORMAL_MESSAGE], "only the mode without sharing");
  assert.deepEqual(off.timers.filter((timer) => timer.delay_ms === 250), []);
});

test("a tab outside a normal window sends no event", async () => {
  const test_case = make({ share_tabs: true });
  await test_case.connect_and_ready();
  test_case.port().posted.length = 0;
  test_case.bridge.tab_updated(50, { audible: true });
  await test_case.bridge.tab_activated(1, 50);
  test_case.bridge.tab_removed(50);
  await test_case.settle();
  assert.deepEqual(test_case.port().posted.filter((message) => message.verb === "event"), []);
});

test("sharing turned off sends tabs_off at once, cancels a pending update and stops the tab events", async () => {
  const test_case = make({ share_tabs: true });
  await test_case.connect_and_ready();
  test_case.port().posted.length = 0;
  test_case.bridge.tab_updated(11, { title: "New" });
  const pending = test_case.timers.find((timer) => timer.delay_ms === 250)!;
  test_case.settings.share_tabs = false;
  await test_case.bridge.settings_changed();
  assert.deepEqual(test_case.port().posted, [{ verb: "event", event: "tabs_off" }]);
  assert.equal(pending.cancelled, true);
  test_case.bridge.tab_updated(11, { audible: false });
  await test_case.bridge.tab_activated(1, 11);
  await test_case.settle();
  assert.deepEqual(test_case.port().posted.filter((message) => message.verb === "event"), [{ verb: "event", event: "tabs_off" }]);
});

test("turning the bridge off with sharing on says tabs_off before the port closes", async () => {
  const test_case = make({ share_tabs: true });
  await test_case.connect_and_ready();
  const port = test_case.port();
  port.posted.length = 0;
  test_case.settings.bridge = false;
  test_case.settings.share_tabs = false;
  await test_case.bridge.settings_changed();
  assert.deepEqual(port.posted, [{ verb: "event", event: "tabs_off" }]);
  assert.equal(port.disconnected, true);
});

test("every ready says tabs_off while sharing is off, so a new host deletes caches a lost tabs_off left", async () => {
  const test_case = make();
  await test_case.connect_and_ready();
  assert.deepEqual(test_case.port().posted.filter((message) => message.verb === "event"), [{ verb: "event", event: "tabs_off" }]);
  test_case.port().drop();
  await test_case.fire_latest();
  test_case.port().say();
  await test_case.settle();
  assert.deepEqual(test_case.port().posted.filter((message) => message.verb === "event"), [{ verb: "event", event: "tabs_off" }], "again after a reconnect");
  const sharing = make({ share_tabs: true });
  await sharing.connect_and_ready();
  assert.deepEqual(sharing.port().posted.filter((message) => message.verb === "event"), [], "not while sharing is on");
});

test("a tab reply asked for before sharing went off goes out as the refusal", async () => {
  let release: () => void = () => undefined;
  const test_case = make({ share_tabs: true, tab_verb: async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return { ok: true, tabs: [{ tab_id: 11, title: "Mail" }] };
  } });
  await test_case.connect_and_ready();
  test_case.port().hear({ verb: "tabs", request_id: 4 });
  await test_case.settle();
  test_case.settings.share_tabs = false;
  await test_case.bridge.settings_changed();
  release();
  await test_case.settle();
  assert.deepEqual(replies_of(test_case.port()), [{ ok: false, message: "tab sharing is off, set bridge_share_tabs to true", sharing: "off", verb: "reply", request_id: 4 }]);
  assert.doesNotMatch(JSON.stringify(test_case.port().posted), /Mail/);
});
