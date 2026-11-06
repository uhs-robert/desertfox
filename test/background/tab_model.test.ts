import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_model, type TabModelDeps, type TabModelMessage, type TabModelPort } from "../../src/background/tab_model.ts";

type Tab = Awaited<ReturnType<TabModelDeps["query"]>>[number];

const tab = (id: number, window_id: number, index: number, extra: Partial<Tab> = {}): Tab =>
  ({ id, windowId: window_id, index, title: `t${id}`, url: `https://s${id}.example/`, active: false, pinned: false, incognito: false, ...extra }) as Tab;

function make(initial: Tab[] = []) {
  const listeners: Record<string, (...args: never[]) => void> = {};
  const events = new Proxy({}, { get: (_t, name: string) => ({ addListener: (fn: (...args: never[]) => void) => void (listeners[name] = fn) }) });
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
      if (fail_query) {
        fail_query = false;
        throw new Error("no tabs");
      }
      const snapshot = tabs.map((t) => ({ ...t }));
      await query_gate;
      return snapshot;
    },
    events: events as unknown as TabModelDeps["events"],
    on_connect: { addListener: (fn) => void (connect = fn) },
    is_extension_page: (port) => port.sender?.url?.startsWith("moz-extension://me/") === true,
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
  const connect_port = (options: { incognito?: boolean; url?: string; name?: string } = {}) => {
    const sent: TabModelMessage[] = [];
    const messages = sent as unknown as Record<0 | 1 | 2 | 3, TabModelMessage> & { length: number };
    let on_message: (m: unknown) => void = () => {};
    let on_disconnect = () => {};
    const port: TabModelPort = {
      name: options.name ?? "desertfox_tab_model",
      sender: { url: options.url ?? "moz-extension://me/sidebar.html", ...(options.incognito === undefined ? {} : { tab: { incognito: options.incognito } }) },
      postMessage: (m) => void sent.push(m),
      onMessage: { addListener: (fn) => void (on_message = fn as (m: unknown) => void) },
      onDisconnect: { addListener: (fn) => void (on_disconnect = fn) },
    };
    connect(port);
    return { port, messages, send: (m: unknown) => on_message(m), disconnect: () => on_disconnect() };
  };
  return {
    model, fire, run_timers, connect_port,
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
    pending_timers: () => timers.length,
    query_calls: () => query_calls,
  };
}

const ids = (m: TabModelMessage) => (m.type === "snapshot" ? m.tabs.map((r) => r.id) : m.upserts.map((r) => r.id));
const order = (m: TabModelMessage) => (m.type === "snapshot" ? m.tabs.map((r) => `${r.window_id}:${r.index}:${r.id}`) : []);

test("a port gets the loaded tabs ordered by window and index, with the site key", async () => {
  const f = make([tab(3, 2, 0), tab(2, 1, 1), tab(1, 1, 0)]);
  await f.model.start();
  const p = f.connect_port();
  assert.deepEqual(order(p.messages[0]), ["1:0:1", "1:1:2", "2:0:3"]);
  assert.equal(p.messages[0].type === "snapshot" && p.messages[0].tabs[0]?.site, "s1.example");
});

test("a title burst sends one patch", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = f.connect_port();
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
  f.connect_port();
  f.fire("onUpdated", 1, { status: "loading" }, tab(1, 1, 0));
  assert.equal(f.pending_timers(), 0);
});

test("create then remove in one batch sends nothing", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  f.fire("onRemoved", 2, { windowId: 1, isWindowClosing: false });
  f.run_timers();
  assert.equal(p.messages.length, 1);
});

test("remove shifts later indexes in the same patch", async () => {
  const f = make([tab(1, 1, 0), tab(2, 1, 1), tab(3, 1, 2), tab(4, 2, 0)]);
  await f.model.start();
  const p = f.connect_port();
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
  const p = f.connect_port();
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
  const p = f.connect_port();
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
  const p = f.connect_port();
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
  const p = f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.run_timers();
  const first = p.messages[1];
  assert.ok(first.type === "patch");
  assert.deepEqual(first.removed, [1]);
  const late = f.connect_port();
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
  const p = f.connect_port();
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
  const p = f.connect_port();
  f.fire("onActivated", { tabId: 2, windowId: 1 });
  f.run_timers();
  const patch = p.messages[1];
  assert.ok(patch.type === "patch");
  assert.deepEqual(patch.upserts.map((r) => [r.id, r.active]).sort(), [[1, false], [2, true]]);
});

test("a port that connects mid-batch gets a snapshot that holds the pending change, and no repeat of it", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const early = f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  const late = f.connect_port();
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
  const gone = f.connect_port();
  const broken = f.connect_port();
  const live = f.connect_port();
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
  const first = f.connect_port();
  const second = f.connect_port();
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
  const normal = f.connect_port({ incognito: false });
  const priv = f.connect_port({ incognito: true });
  const unknown = f.connect_port();
  assert.deepEqual(ids(normal.messages[0]), [1]);
  assert.deepEqual(ids(priv.messages[0]), [2]);
  assert.deepEqual(ids(unknown.messages[0]), [1]);
  f.fire("onUpdated", 2, { title: "p" }, tab(2, 5, 0, { incognito: true, title: "p" }));
  f.fire("onRemoved", 2, { windowId: 5, isWindowClosing: false });
  f.run_timers();
  assert.equal(normal.messages.length, 1);
  assert.equal(priv.messages.length, 2);
});

test("a patch for one privacy leaves the other port's rev alone", async () => {
  const f = make([tab(1, 1, 0), tab(2, 5, 0, { incognito: true })]);
  await f.model.start();
  const normal = f.connect_port({ incognito: false });
  const priv = f.connect_port({ incognito: true });
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
  assert.equal(f.connect_port({ url: "https://evil.example/" }).messages.length, 0);
  assert.equal(f.connect_port({ name: "other" }).messages.length, 0);
});

test("resync sends a fresh snapshot at the port's current rev", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = f.connect_port();
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

test("settled flushes pending changes now", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = f.connect_port();
  f.fire("onCreated", tab(2, 1, 1));
  await f.model.settled();
  assert.equal(p.messages.length, 2);
  assert.equal(f.pending_timers(), 0);
});

test("a port that connects before the load ends waits for the snapshot", async () => {
  const f = make([tab(1, 1, 0)]);
  const release = f.hold_query();
  const started = f.model.start();
  const p = f.connect_port();
  assert.equal(p.messages.length, 0);
  release();
  await started;
  assert.deepEqual(order(p.messages[0]), ["1:0:1"]);
});

test("an event during the startup query forces a second query, so the result is not stale", async () => {
  const f = make([tab(1, 1, 0)]);
  const release = f.hold_query();
  const started = f.model.start();
  const p = f.connect_port();
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
  assert.deepEqual(order(f.connect_port().messages[0]), ["1:0:1", "1:1:2"]);
});
