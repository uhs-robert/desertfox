import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bridge, FIRST_RETRY_MS, MAX_RETRY_MS, STABLE_MS } from "../../src/background/bridge.ts";
import type { BridgeDeps, BridgePort, BridgeWindow } from "../../src/background/bridge.ts";
import type { Mode } from "../../src/shared/command.ts";

function make(options: { bridge?: boolean; missing_host?: boolean; permission?: boolean } = {}) {
  const settings = { bridge: options.bridge ?? true };
  const state = { permission: options.permission ?? true, gate: undefined as Promise<void> | undefined };
  const windows = new Map<number, BridgeWindow>([[1, { id: 1, focused: true, private: false }], [2, { id: 2, focused: false, private: false }]]);
  const active_tab = new Map<number, number>([[1, 11], [2, 22]]);
  const modes = new Map<number, Mode>();
  const ports: (BridgePort & { posted: Record<string, unknown>[]; disconnected: boolean; say: () => void; drop: () => void; throw_on_post: boolean })[] = [];
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
  };
  const bridge = create_bridge(deps);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  const pending = () => timers.filter((timer) => !timer.cancelled);
  return {
    bridge, settings, state, windows, active_tab, modes, ports, counts, settle,
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
  assert.equal(test_case.port().posted.length, 1);
});

test("once ready the host gets a full snapshot", async () => {
  const test_case = make();
  test_case.modes.set(11, "insert");
  await test_case.connect_and_ready();
  assert.deepEqual(test_case.port().posted, [{ ...NORMAL_MESSAGE, id: "insert", label: "INSERT" }]);
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
  await test_case.bridge.tab_activated(2);
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
  assert.equal(hint.port().posted[0]!.label, "");
  assert.equal(hint.port().posted[0]!.id, "hint");
  const visual = make();
  visual.modes.set(11, "visual");
  await visual.connect_and_ready();
  assert.equal(visual.port().posted[0]!.label, "VISUAL");
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
  await test_case.bridge.tab_activated(2);
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
  await test_case.bridge.tab_activated(2);
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
  assert.deepEqual(test_case.port().posted, [{ ...NORMAL_MESSAGE, id: "insert", label: "INSERT" }]);
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
  assert.deepEqual(second.posted, [{ ...NORMAL_MESSAGE, id: "insert", label: "INSERT" }]);
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
