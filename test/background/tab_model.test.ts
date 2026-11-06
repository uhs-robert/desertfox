import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_model, type TabModelDeps, type TabModelPort } from "../../src/background/tab_model.ts";
import { create_cmdline_service } from "../../src/background/cmdline_service.ts";
import type { ContainerIdentity, WindowLike } from "../../src/background/complete_items.ts";
import type { TabModelMessage, TabRow } from "../../src/shared/messages.ts";

type Tab = Awaited<ReturnType<TabModelDeps["query"]>>[number];
type Gate = { promise: Promise<void>; release: () => void };
const gate = (): Gate => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => void (release = resolve));
  return { promise, release };
};
// Lets the model's own awaits (window and container reads, the ticket check) finish.
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const win = (id: number, extra: Partial<WindowLike> = {}): WindowLike => ({ id, type: "normal", incognito: false, ...extra });

type Options = {
  windows?: WindowLike[];
  containers?: Map<string, ContainerIdentity>;
  previous?: Record<number, number>;
  is_opener?: (tab_id: number) => Promise<boolean>;
};

const tab = (id: number, window_id: number, index: number, extra: Partial<Tab> = {}): Tab =>
  ({ id, windowId: window_id, index, title: `t${id}`, url: `https://s${id}.example/`, active: false, pinned: false, incognito: false, ...extra }) as Tab;

function make(initial: Tab[] = [], options: Options = {}) {
  const listeners: Record<string, (...args: never[]) => void> = {};
  const events_named = (prefix: string) =>
    new Proxy({}, { get: (_t, name: string) => ({ addListener: (fn: (...args: never[]) => void) => void (listeners[prefix + name] = fn) }) });
  const events = events_named("");
  // Every window that holds a tab, unless the test names them.
  let windows = options.windows ?? [...new Set(initial.map((t) => t.windowId as number))].sort((a, b) => a - b).map((id) => win(id));
  let containers: Map<string, ContainerIdentity> | "off" = options.containers ?? new Map();
  let window_gate: Gate | undefined;
  const opener_asks: number[] = [];
  let connect: (port: TabModelPort) => void = () => {};
  let timers: Array<{ id: number; fn: () => void }> = [];
  let next_timer = 1;
  let tabs = initial;
  let query_gate: Promise<void> | undefined;
  let query_calls = 0;
  let fail_query = false;
  const model = create_tab_model({
    query: async () => {
      query_calls += 1;
      const snapshot = tabs.map((t) => ({ ...t }));
      const fails = fail_query;
      fail_query = false;
      await query_gate;
      if (fails) throw new Error("no tabs");
      return snapshot;
    },
    events: events as unknown as TabModelDeps["events"],
    windows: async () => {
      const snapshot = windows.map((w) => ({ ...w }));
      const held = window_gate;
      window_gate = undefined;
      await held?.promise;
      return snapshot;
    },
    window_events: events_named("windows.") as unknown as TabModelDeps["window_events"],
    containers: async () => {
      if (containers === "off") throw new Error("containers are off");
      return new Map(containers);
    },
    container_events: events_named("containers.") as unknown as TabModelDeps["container_events"],
    previous_of: async (window_id) => options.previous?.[window_id],
    on_connect: { addListener: (fn) => void (connect = fn) },
    is_extension_page: (port) => port.sender?.url?.startsWith("moz-extension://me/") === true,
    is_opener: (tab_id) => {
      opener_asks.push(tab_id);
      return options.is_opener ? options.is_opener(tab_id) : Promise.resolve(true);
    },
    set_timer: (fn) => {
      const id = next_timer++;
      timers.push({ id, fn });
      return id;
    },
    clear_timer: (handle) => void (timers = timers.filter((t) => t.id !== handle)),
  });
  const fire = (name: string, ...args: unknown[]) => (listeners[name] as unknown as (...a: unknown[]) => void)(...args);
  const run_timers = () => {
    const due = timers;
    timers = [];
    for (const t of due) t.fn();
  };
  const connect_port_now = (options: { incognito?: boolean; url?: string; name?: string; no_sender_tab?: true; tab_id?: number | "none" } = {}) => {
    const sent: TabModelMessage[] = [];
    const messages = sent as unknown as Record<0 | 1 | 2 | 3, TabModelMessage> & { length: number };
    let on_message: (m: unknown) => void = () => {};
    let on_disconnect = () => {};
    let closed = false;
    const tab_id = options.tab_id === "none" ? {} : { id: options.tab_id ?? 7 };
    const port: TabModelPort = {
      name: options.name ?? "desertfox_tab_model",
      sender: { url: options.url ?? "moz-extension://me/sidebar.html", ...(options.no_sender_tab ? {} : { tab: { ...tab_id, incognito: options.incognito ?? false } }) },
      postMessage: (m) => void sent.push(m),
      disconnect: () => void (closed = true),
      onMessage: { addListener: (fn) => void (on_message = fn as (m: unknown) => void) },
      onDisconnect: { addListener: (fn) => void (on_disconnect = fn) },
    };
    connect(port);
    return { port, messages, send: (m: unknown) => on_message(m), disconnect: () => on_disconnect(), closed: () => closed };
  };
  // Waits out the ticket check, which every port with a sender tab goes through.
  const connect_port = async (port_options: Parameters<typeof connect_port_now>[0] = {}) => {
    const connected = connect_port_now(port_options);
    await tick();
    return connected;
  };
  return {
    model, fire, run_timers, connect_port, connect_port_now,
    set_tabs: (t: Tab[]) => void (tabs = t),
    hold_query: () => {
      let release = () => {};
      query_gate = new Promise<void>((resolve) => void (release = resolve));
      return () => {
        query_gate = undefined;
        release();
      };
    },
    fail_next_query: () => void (fail_query = true),
    set_windows: (w: WindowLike[]) => void (windows = w),
    // Holds the next window read until the returned function runs.
    hold_windows: () => {
      window_gate = gate();
      return window_gate.release;
    },
    set_containers: (c: Map<string, ContainerIdentity> | "off") => void (containers = c),
    opener_asks,
    pending_timers: () => timers.length,
    query_calls: () => query_calls,
  };
}

const ids = (m: TabModelMessage) => (m.type === "snapshot" ? m.tabs.map((r) => r.id) : m.upserts.map((r) => r.id));
const order = (m: TabModelMessage) => (m.type === "snapshot" ? m.tabs.map((r) => `${r.window_id}:${r.index}:${r.id}`) : []);

test("a port gets the loaded tabs ordered by window and index, with the site key", async () => {
  const f = make([tab(3, 2, 0), tab(2, 1, 1), tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  assert.deepEqual(order(p.messages[0]), ["1:0:1", "1:1:2", "2:0:3"]);
  assert.equal(p.messages[0].type === "snapshot" && p.messages[0].tabs[0]?.site, "s1.example");
});

test("a title burst sends one patch", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  for (const title of ["a", "ab", "abc"]) f.fire("onUpdated", 1, { title }, tab(1, 1, 0, { title }));
  assert.equal(p.messages.length, 1);
  f.run_timers();
  assert.equal(p.messages.length, 2);
  const patch = p.messages[1];
  assert.equal(patch.type === "patch" && patch.rev, 1);
  assert.equal(patch.type === "patch" && patch.upserts[0]?.title, "abc");
});

test("an update that changes nothing sends nothing", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  await f.connect_port();
  f.fire("onUpdated", 1, { status: "loading" }, tab(1, 1, 0));
  assert.equal(f.pending_timers(), 0);
});

test("create then remove in one batch sends nothing", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  f.fire("onRemoved", 2, { windowId: 1, isWindowClosing: false });
  f.run_timers();
  assert.equal(p.messages.length, 1);
});

test("remove shifts later indexes in the same patch", async () => {
  const f = make([tab(1, 1, 0), tab(2, 1, 1), tab(3, 1, 2), tab(4, 2, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onRemoved", 1, { windowId: 1, isWindowClosing: false });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.removed, [1]);
  assert.deepEqual(patch.upserts.map((r) => [r.id, r.index]), [[2, 0], [3, 1]]);
});

test("an update after the remove is ignored", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onRemoved", 1, { windowId: 1, isWindowClosing: false });
  f.fire("onUpdated", 1, { title: "late" }, tab(1, 1, 0, { title: "late" }));
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual([patch.removed, patch.upserts], [[1], []]);
});

test("move shifts the tabs it passes", async () => {
  const f = make([tab(1, 1, 0), tab(2, 1, 1), tab(3, 1, 2)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onMoved", 1, { windowId: 1, fromIndex: 0, toIndex: 2 });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.upserts.map((r) => [r.id, r.index]).sort(), [[1, 2], [2, 0], [3, 1]]);
  f.fire("onMoved", 1, { windowId: 1, fromIndex: 2, toIndex: 0 });
  f.run_timers();
  const back = p.messages[2];
  assert.ok(back.type === "patch");
  assert.deepEqual(back.upserts.map((r) => [r.id, r.index]).sort(), [[1, 0], [2, 1], [3, 2]]);
});

test("detach and attach across windows in one batch is one upsert, no removal", async () => {
  const f = make([tab(1, 1, 0), tab(2, 1, 1), tab(3, 2, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.fire("onAttached", 1, { newWindowId: 2, newPosition: 0 });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.removed, []);
  assert.deepEqual(patch.upserts.map((r) => `${r.window_id}:${r.index}:${r.id}`).sort(), ["1:0:2", "2:0:1", "2:1:3"]);
});

test("a flush between detach and attach hides the tab, and the attach brings it back", async () => {
  const f = make([tab(1, 1, 0), tab(2, 1, 1)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.run_timers();
  const first = p.messages[1];
  assert.ok(first.type === "patch");
  assert.deepEqual(first.removed, [1]);
  const late = await f.connect_port();
  assert.deepEqual(order(late.messages[0]), ["1:0:2"]);
  f.fire("onAttached", 1, { newWindowId: 2, newPosition: 0 });
  f.run_timers();
  const second = p.messages[2];
  assert.ok(second.type === "patch");
  assert.deepEqual(second.upserts.map((r) => `${r.window_id}:${r.index}:${r.id}`), ["2:0:1"]);
  assert.deepEqual(late.messages[1] && ids(late.messages[1]), [1]);
});

test("removing a detached tab does not break the model", async () => {
  const f = make([tab(1, 1, 0), tab(2, 1, 1)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.fire("onRemoved", 1, { windowId: 1, isWindowClosing: false });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.removed, [1]);
});

test("activation moves the active flag inside its window only", async () => {
  const f = make([tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 2, 0, { active: true })]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onActivated", { tabId: 2, windowId: 1 });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.upserts.map((r) => [r.id, r.active]).sort(), [[1, false], [2, true]]);
});

test("a port that connects mid-batch gets a snapshot that holds the pending change, and no repeat of it", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const early = await f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  const late = await f.connect_port();
  assert.deepEqual(order(late.messages[0]), ["1:0:1", "1:1:2"]);
  assert.equal(early.messages.length, 2, "pending change flushed to the earlier port");
  f.fire("onUpdated", 2, { title: "x" }, tab(2, 1, 1, { title: "x" }));
  f.run_timers();
  const patch = late.messages[1];
  assert.ok(patch.type === "patch");
  assert.equal(patch.rev, 1);
  assert.deepEqual(ids(patch), [2]);
  assert.equal(f.pending_timers(), 0);
});

test("a port that disconnects, or whose post throws, does not stop the flush for others", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const gone = await f.connect_port();
  const broken = await f.connect_port();
  const live = await f.connect_port();
  (broken.port as { postMessage: unknown }).postMessage = () => {
    throw new Error("disconnected");
  };
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  gone.disconnect();
  f.run_timers();
  assert.equal(gone.messages.length, 1);
  assert.equal(live.messages.length, 2);
  f.fire("onUpdated", 1, { title: "zz" }, tab(1, 1, 0, { title: "zz" }));
  f.run_timers();
  assert.equal(live.messages.length, 3);
});

test("a port disconnecting from inside the flush does not skip the next port", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const first = await f.connect_port();
  const second = await f.connect_port();
  (first.port as { postMessage: unknown }).postMessage = () => {
    first.disconnect();
  };
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  assert.equal(second.messages.length, 2);
});

test("private ports see private tabs only and normal ports never see them", async () => {
  const f = make([tab(1, 1, 0), tab(2, 5, 0, { incognito: true })]);
  await f.model.start();
  const normal = await f.connect_port({ incognito: false });
  const priv = await f.connect_port({ incognito: true });
  assert.deepEqual(ids(normal.messages[0]), [1]);
  assert.deepEqual(ids(priv.messages[0]), [2]);
  f.fire("onUpdated", 2, { title: "p" }, tab(2, 5, 0, { incognito: true, title: "p" }));
  f.fire("onRemoved", 2, { windowId: 5, isWindowClosing: false });
  f.run_timers();
  assert.equal(normal.messages.length, 1);
  assert.equal(priv.messages.length, 2);
});

test("a patch for one privacy leaves the other port's rev alone", async () => {
  const f = make([tab(1, 1, 0), tab(2, 5, 0, { incognito: true })]);
  await f.model.start();
  const normal = await f.connect_port({ incognito: false });
  const priv = await f.connect_port({ incognito: true });
  f.fire("onUpdated", 2, { title: "p" }, tab(2, 5, 0, { incognito: true, title: "p" }));
  f.run_timers();
  f.fire("onUpdated", 1, { title: "n" }, tab(1, 1, 0, { title: "n" }));
  f.run_timers();
  const patch = normal.messages[1];
  assert.ok(patch.type === "patch");
  assert.equal(patch.rev, 1);
  assert.equal(priv.messages.length, 2);
});

test("a content script or another port name is refused", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  assert.equal((await f.connect_port({ url: "https://evil.example/" })).messages.length, 0);
  assert.equal((await f.connect_port({ name: "other" })).messages.length, 0);
});

test("resync sends a fresh snapshot at the port's current rev", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  p.send({ type: "resync" });
  const snap = p.messages[2];
  assert.ok(snap.type === "snapshot");
  assert.equal(snap.rev, 1);
  assert.equal(snap.tabs[0]?.title, "z");
  p.send({ type: "nonsense" });
  assert.equal(p.messages.length, 3);
});

test("settled flushes pending changes now and never re-queries", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  await f.model.settled();
  await f.model.start();
  assert.equal(f.query_calls(), 1);
  assert.equal(p.messages.length, 2);
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(ids(patch), [2]);
  assert.equal(f.pending_timers(), 0);
});

test("a port that connects before the load ends waits for the snapshot", async () => {
  const f = make([tab(1, 1, 0)]);
  const release = f.hold_query();
  const started = f.model.start();
  const p = await f.connect_port();
  assert.equal(p.messages.length, 0);
  release();
  await started;
  assert.deepEqual(order(p.messages[0]), ["1:0:1"]);
});

test("an event during the startup query forces a second query, so the result is not stale", async () => {
  const f = make([tab(1, 1, 0)]);
  const release = f.hold_query();
  const started = f.model.start();
  const p = await f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  f.set_tabs([tab(1, 1, 0), tab(2, 1, 1)]);
  release();
  await started;
  assert.equal(f.query_calls(), 2);
  assert.deepEqual(order(p.messages[0]), ["1:0:1", "1:1:2"]);
  assert.equal(f.pending_timers(), 0);
  f.fire("onRemoved", 1, { windowId: 1, isWindowClosing: false });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.upserts.map((r) => [r.id, r.index]), [[2, 0]]);
});

test("a failed startup query is retried on the next event", async () => {
  const f = make([tab(1, 1, 0)]);
  f.fail_next_query();
  await f.model.start();
  f.set_tabs([tab(1, 1, 0), tab(2, 1, 1)]);
  f.fire("onCreated", tab(2, 1, 1));
  await f.model.settled();
  assert.equal(f.query_calls(), 2);
  assert.deepEqual(order((await f.connect_port()).messages[0]), ["1:0:1", "1:1:2"]);
});

test("an event during a startup query that then fails still leads to a fresh query", async () => {
  const f = make([tab(1, 1, 0)]);
  const release = f.hold_query();
  f.fail_next_query();
  const started = f.model.start();
  const p = await f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  f.set_tabs([tab(1, 1, 0), tab(2, 1, 1)]);
  release();
  await started;
  assert.equal(f.query_calls(), 2);
  assert.deepEqual(order(p.messages[0]), ["1:0:1", "1:1:2"]);
});

test("a page without a sender tab states its privacy in the port name, and a port that states none gets no rows", async () => {
  const f = make([tab(1, 1, 0), tab(2, 5, 0, { incognito: true })]);
  await f.model.start();
  const priv = await f.connect_port({ name: "desertfox_tab_model:private", no_sender_tab: true });
  const normal = await f.connect_port({ name: "desertfox_tab_model:normal", no_sender_tab: true });
  const silent = await f.connect_port({ no_sender_tab: true });
  assert.deepEqual(ids(priv.messages[0]), [2]);
  assert.deepEqual(ids(normal.messages[0]), [1]);
  assert.deepEqual(ids(silent.messages[0]), []);
  f.fire("onUpdated", 1, { title: "n" }, tab(1, 1, 0, { title: "n" }));
  f.fire("onUpdated", 2, { title: "p" }, tab(2, 5, 0, { incognito: true, title: "p" }));
  f.run_timers();
  assert.equal(silent.messages.length, 1);
  assert.equal(priv.messages.length, 2);
});

test("the sender tab decides privacy over the port name", async () => {
  const f = make([tab(1, 1, 0), tab(2, 5, 0, { incognito: true })]);
  await f.model.start();
  const p = await f.connect_port({ name: "desertfox_tab_model:normal", incognito: true });
  assert.deepEqual(ids(p.messages[0]), [2]);
});

test("rows carry only a favicon an extension page can load", async () => {
  const f = make([tab(1, 1, 0, { favIconUrl: "chrome://branding/x.png" }), tab(2, 1, 1, { favIconUrl: "https://a.example/i.png" }), tab(3, 1, 2, { favIconUrl: `data:image/png;base64,${"A".repeat(3000)}` })]);
  await f.model.start();
  const p = await f.connect_port();
  const snap = p.messages[0];
  assert.ok(snap.type === "snapshot");
  assert.deepEqual(snap.tabs.map((r) => r.favicon_url), ["", "https://a.example/i.png", ""]);
});

test("an update between detach and attach is kept", async () => {
  const f = make([tab(1, 1, 0), tab(2, 2, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.fire("onUpdated", 1, { title: "new" }, tab(1, 1, 0, { title: "new" }));
  f.fire("onAttached", 1, { newWindowId: 2, newPosition: 1 });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.upserts.map((r) => [r.id, r.title]), [[1, "new"]]);
});

test("a tab torn off into a new window is active there, one moved into a window with an active tab is not", async () => {
  const f = make([tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 2, 0, { active: true })]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.fire("onAttached", 1, { newWindowId: 9, newPosition: 0 });
  f.run_timers();
  const torn = p.messages[1];
  assert.ok(torn.type === "patch");
  assert.deepEqual(torn.upserts.filter((r) => r.id === 1).map((r) => r.active), [true]);
  f.fire("onDetached", 2, { oldWindowId: 1, oldPosition: 0 });
  f.fire("onAttached", 2, { newWindowId: 2, newPosition: 1 });
  f.run_timers();
  const joined = p.messages[2];
  assert.ok(joined.type === "patch");
  assert.deepEqual(joined.upserts.filter((r) => r.id === 2).map((r) => r.active), [false]);
});

test("a port named after an object prototype member is refused", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  assert.equal((await f.connect_port({ name: "constructor" })).messages.length, 0);
});

const rows_of = (m: TabModelMessage | undefined): TabRow[] => (m === undefined ? [] : m.type === "snapshot" ? m.tabs : m.upserts);
const pick = <Field extends keyof TabRow>(m: TabModelMessage | undefined, field: Field) => rows_of(m).map((r) => [r.id, r[field]] as const);

// The ticket gate

test("a port from a tab with no ticket is closed and never gets a snapshot or a patch", async () => {
  const f = make([tab(1, 1, 0)], { is_opener: async () => false });
  await f.model.start();
  const p = await f.connect_port({ tab_id: 7 });
  assert.deepEqual([p.messages.length, p.closed(), f.opener_asks], [0, true, [7]]);
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  p.send({ type: "resync" });
  assert.equal(p.messages.length, 0);
});

test("a framed command line page in a web page's tab cannot connect", async () => {
  // The frame is an extension page, but its tab redeemed no ticket.
  const f = make([tab(1, 1, 0)], { is_opener: async (tab_id) => tab_id === 7 });
  await f.model.start();
  const framed = await f.connect_port({ url: "moz-extension://me/cmdline.html", tab_id: 3 });
  assert.deepEqual([framed.messages.length, framed.closed()], [0, true]);
});

test("a sender tab without an id, or a ticket check that fails, is closed", async () => {
  const f = make([tab(1, 1, 0)], { is_opener: async () => Promise.reject(new Error("storage gone")) });
  await f.model.start();
  const no_id = await f.connect_port({ tab_id: "none" });
  const failed = await f.connect_port();
  assert.deepEqual([no_id.messages.length, no_id.closed(), failed.messages.length, failed.closed()], [0, true, 0, true]);
});

test("a ticketed port gets its snapshot and then patches, and a port with no sender tab skips the check", async () => {
  const f = make([tab(1, 1, 0)], { is_opener: async (tab_id) => tab_id === 7 });
  await f.model.start();
  const p = await f.connect_port({ tab_id: 7 });
  const sidebar = await f.connect_port({ name: "desertfox_tab_model:normal", no_sender_tab: true });
  assert.deepEqual(f.opener_asks, [7]);
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  assert.deepEqual([p.closed(), p.messages[0].type, pick(p.messages[1], "title")], [false, "snapshot", [[1, "z"]]]);
  assert.equal(sidebar.messages.length, 2);
});

test("a slow ticket check holds back every message, and the snapshot then holds the change", async () => {
  const check = gate();
  const f = make([tab(1, 1, 0)], { is_opener: async () => check.promise.then(() => true) });
  await f.model.start();
  const p = f.connect_port_now();
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  p.send({ type: "resync" });
  assert.equal(p.messages.length, 0);
  check.release();
  await tick();
  assert.deepEqual(pick(p.messages[0], "title"), [[1, "z"]]);
  assert.equal(p.messages.length, 1);
});

test("a port that disconnects during the ticket check is never added", async () => {
  const check = gate();
  const f = make([tab(1, 1, 0)], { is_opener: async () => check.promise.then(() => true) });
  await f.model.start();
  const p = f.connect_port_now();
  p.disconnect();
  check.release();
  await tick();
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  assert.equal(p.messages.length, 0);
});

test("with the real ticket service, only the tab that redeemed its own ticket reads the model", async () => {
  const store = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => store.set(key, value)),
    remove: async (key: string) => void store.delete(key),
  };
  let next = 0;
  const cmdline = create_cmdline_service({
    storage: storage as never,
    tickets: storage as never,
    new_ticket: () => `ticket-${++next}`,
    sources: async () => ({ search_engines: [], containers: [] }),
    page_config: async () => ({ commands: [], help_ids: [], command_aliases: {}, prompt: ":" }) as never,
  });
  const f = make([tab(1, 1, 0)], { is_opener: cmdline.is_opener });
  await f.model.start();

  assert.ok((await f.connect_port({ tab_id: 7 })).closed(), "no ticket");
  assert.equal(await cmdline.open("guessed", 7), undefined);
  assert.ok((await f.connect_port({ tab_id: 7 })).closed(), "a wrong ticket");

  const ticket = await cmdline.issue_ticket(8);
  assert.ok(await cmdline.open(ticket, 8));
  assert.equal(await cmdline.open(ticket, 9), undefined);
  const reused = await f.connect_port({ tab_id: 9 });
  assert.deepEqual([reused.closed(), reused.messages.length], [true, 0], "a reused ticket");

  const owner = await f.connect_port({ tab_id: 8 });
  assert.deepEqual([owner.closed(), owner.messages[0].type], [false, "snapshot"]);
  await cmdline.forget_opener_on_navigation(8, { status: "loading" });
  assert.ok((await f.connect_port({ tab_id: 8 })).closed(), "the tab navigated away");
});

// Window numbers

test("rows carry their window's place in windows.getAll: a popup and a private window count a place", async () => {
  const windows = [win(1), win(2, { type: "popup" }), win(3, { incognito: true }), win(4)];
  const f = make([tab(1, 1, 0), tab(2, 2, 0), tab(3, 3, 0, { incognito: true }), tab(4, 4, 0)], { windows });
  await f.model.start();
  const normal = await f.connect_port();
  const priv = await f.connect_port({ incognito: true });
  assert.deepEqual(pick(normal.messages[0], "window_number"), [[1, 1], [2, 0], [4, 4]]);
  assert.deepEqual(pick(priv.messages[0], "window_number"), [[3, 3]]);
});

test("closing a window renumbers the later windows in one patch of the changed rows only", async () => {
  const f = make([tab(1, 1, 0), tab(2, 2, 0), tab(3, 3, 0), tab(4, 3, 1)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onRemoved", 2, { windowId: 2, isWindowClosing: true });
  f.set_windows([win(1), win(3)]);
  f.fire("windows.onRemoved", 2);
  await tick();
  f.run_timers();
  assert.equal(p.messages.length, 2);
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.removed, [2]);
  assert.deepEqual(pick(patch, "window_number"), [[3, 2], [4, 2]]);
});

test("a tab of a new window gets its number once the window read lands, and older windows keep theirs", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.set_windows([win(1), win(2)]);
  f.fire("windows.onCreated", win(2));
  f.fire("onCreated", tab(2, 2, 0, { active: true }));
  await tick();
  f.run_timers();
  assert.deepEqual(pick(p.messages[1], "window_number"), [[2, 2]]);
});

test("a window read that lands after a newer one is dropped", async () => {
  const f = make([tab(1, 1, 0), tab(3, 3, 0)], { windows: [win(1), win(2), win(3)] });
  await f.model.start();
  const p = await f.connect_port();
  const release_old = f.hold_windows();
  f.fire("windows.onCreated", win(2));
  f.set_windows([win(1), win(3)]);
  f.fire("windows.onRemoved", 2);
  await tick();
  release_old();
  await tick();
  f.run_timers();
  assert.deepEqual(pick(p.messages[1], "window_number"), [[3, 2]]);
  assert.equal(p.messages.length, 2);
});

test("an attach takes the number of the new window", async () => {
  const f = make([tab(1, 1, 0), tab(2, 1, 1), tab(3, 2, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.fire("onAttached", 1, { newWindowId: 2, newPosition: 1 });
  f.run_timers();
  assert.deepEqual(pick(p.messages[1], "window_number").filter(([id]) => id === 1), [[1, 2]]);
});

test("a window event during the load restarts it", async () => {
  const f = make([tab(1, 1, 0)]);
  const release = f.hold_query();
  const started = f.model.start();
  const p = await f.connect_port();
  f.set_windows([win(5), win(1)]);
  f.fire("windows.onCreated", win(5));
  release();
  await started;
  assert.equal(f.query_calls(), 2);
  assert.deepEqual(pick(p.messages[0], "window_number"), [[1, 2]]);
});

// The previous tab

test("the load seeds the previous tab of each window, never on the active tab", async () => {
  const tabs = [tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 2, 0, { active: true }), tab(4, 2, 1)];
  const f = make(tabs, { previous: { 1: 2, 2: 3 } });
  await f.model.start();
  const p = await f.connect_port();
  assert.deepEqual(pick(p.messages[0], "previous"), [[1, false], [2, true], [3, false], [4, false]]);
});

test("an activation moves the previous mark inside its window only", async () => {
  const tabs = [tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 1, 2), tab(4, 2, 0, { active: true }), tab(5, 2, 1)];
  const f = make(tabs, { previous: { 2: 5 } });
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onActivated", { tabId: 2, windowId: 1, previousTabId: 1 });
  f.run_timers();
  assert.deepEqual(pick(p.messages[1], "previous").sort(), [[1, true], [2, false]]);
  f.fire("onActivated", { tabId: 1, windowId: 1, previousTabId: 2 });
  f.run_timers();
  assert.deepEqual(pick(p.messages[2], "previous").sort(), [[1, false], [2, true]]);
  const late = await f.connect_port();
  assert.deepEqual(pick(late.messages[0], "previous").filter(([, previous]) => previous), [[2, true], [5, true]]);
});

test("closing the previous tab leaves the window without one, and a first activation has none", async () => {
  const f = make([tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 1, 2)], { previous: { 1: 2 } });
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onRemoved", 2, { windowId: 1, isWindowClosing: false });
  f.run_timers();
  assert.deepEqual(pick(p.messages[1], "previous"), [[3, false]]);
  f.fire("onActivated", { tabId: 3, windowId: 1, previousTabId: 1 });
  f.fire("onRemoved", 1, { windowId: 1, isWindowClosing: false });
  f.fire("onActivated", { tabId: 3, windowId: 1 });
  f.run_timers();
  const late = await f.connect_port();
  assert.deepEqual(pick(late.messages[0], "previous"), [[3, false]]);
});

test("closing a window leaves the previous tab of the other windows alone", async () => {
  const f = make([tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 2, 0, { active: true }), tab(4, 2, 1)], { previous: { 1: 2, 2: 4 } });
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onRemoved", 3, { windowId: 2, isWindowClosing: true });
  f.fire("onRemoved", 4, { windowId: 2, isWindowClosing: true });
  f.set_windows([win(1)]);
  f.fire("windows.onRemoved", 2);
  await tick();
  f.run_timers();
  const late = await f.connect_port();
  assert.deepEqual(pick(late.messages[0], "previous"), [[1, false], [2, true]]);
  assert.equal(p.messages.length, 2);
});

test("a previous tab moved to another window loses the mark", async () => {
  const f = make([tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 2, 0, { active: true })], { previous: { 1: 2 } });
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 2, { oldWindowId: 1, oldPosition: 1 });
  f.fire("onAttached", 2, { newWindowId: 2, newPosition: 1 });
  f.run_timers();
  assert.deepEqual(pick(p.messages[1], "previous"), [[2, false]]);
});

// Containers

const WORK: ContainerIdentity = { name: "Work", color: "#37adff", icon: "resource://usercontext-content/briefcase.svg" };

test("rows carry the container's name, color and icon, and none for the default container or a private tab", async () => {
  const tabs = [tab(1, 1, 0, { cookieStoreId: "firefox-container-1" }), tab(2, 1, 1, { cookieStoreId: "firefox-default" }), tab(3, 2, 0, { incognito: true, cookieStoreId: "firefox-private" })];
  const f = make(tabs, { containers: new Map([["firefox-container-1", WORK]]) });
  await f.model.start();
  const normal = await f.connect_port();
  const priv = await f.connect_port({ incognito: true });
  const marks = (m: TabModelMessage | undefined) => rows_of(m).map((r) => [r.id, r.container, r.container_name, r.container_color, r.container_icon]);
  assert.deepEqual(marks(normal.messages[0]), [[1, "firefox-container-1", "Work", WORK.color, WORK.icon], [2, "firefox-default", "", "", ""]]);
  assert.deepEqual(marks(priv.messages[0]), [[3, "firefox-private", "", "", ""]]);
});

test("a renamed container patches its rows only, and a deleted one leaves its tabs with no name", async () => {
  const tabs = [tab(1, 1, 0, { cookieStoreId: "firefox-container-1" }), tab(2, 1, 1)];
  const f = make(tabs, { containers: new Map([["firefox-container-1", WORK]]) });
  await f.model.start();
  const p = await f.connect_port();
  f.set_containers(new Map([["firefox-container-1", { ...WORK, name: "Job", color: "#ff0000" }]]));
  f.fire("containers.onUpdated", {});
  await tick();
  f.run_timers();
  assert.deepEqual(rows_of(p.messages[1]).map((r) => [r.id, r.container_name, r.container_color]), [[1, "Job", "#ff0000"]]);
  // Firefox closes a deleted container's tabs, but a tab that outlives the delete must not keep a stale name.
  f.set_containers(new Map());
  f.fire("containers.onRemoved", {});
  await tick();
  f.run_timers();
  assert.deepEqual(rows_of(p.messages[2]).map((r) => [r.id, r.container, r.container_name, r.container_color, r.container_icon]), [[1, "firefox-container-1", "", "", ""]]);
  f.fire("onUpdated", 1, { title: "t" }, tab(1, 1, 0, { cookieStoreId: "firefox-container-1", title: "t" }));
  f.run_timers();
  assert.deepEqual(pick(p.messages[3], "container_name"), [[1, ""]]);
});

test("with containers off every row has empty container marks", async () => {
  const f = make([tab(1, 1, 0, { cookieStoreId: "firefox-container-1" })]);
  f.set_containers("off");
  await f.model.start();
  const p = await f.connect_port();
  assert.deepEqual(pick(p.messages[0], "container_name"), [[1, ""]]);
  assert.equal(f.query_calls(), 1);
});

// Reads for action messages

test("row_of gives a copy, and ids_of_privacy lists one privacy only", async () => {
  const f = make([tab(1, 1, 0), tab(2, 5, 0, { incognito: true })]);
  await f.model.start();
  const row = f.model.row_of(1);
  assert.equal(row?.title, "t1");
  if (row) row.title = "changed";
  assert.equal(f.model.row_of(1)?.title, "t1");
  assert.equal(f.model.row_of(9), undefined);
  assert.deepEqual([f.model.ids_of_privacy(false), f.model.ids_of_privacy(true)], [[1], [2]]);
});
