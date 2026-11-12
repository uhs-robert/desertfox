import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { create_tab_model, type TabModelDeps, type TabModelPort } from "../../src/background/tab_model.ts";
import { create_cmdline_service } from "../../src/background/cmdline_service.ts";
import type { ContainerIdentity, WindowLike } from "../../src/background/complete_items.ts";
import type { TabModelMessage, TabRow } from "../../src/shared/messages.ts";

type Tab = Awaited<ReturnType<TabModelDeps["query"]>>[number];
type Group = Awaited<ReturnType<TabModelDeps["groups"]>>[number];
type Gate = { promise: Promise<void>; release: () => void };
const gate = (): Gate => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => void (release = resolve));
  return { promise, release };
};
// Lets the model's own awaits (window and container reads, the ticket check) finish.
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
// The one web-accessible page, which a web page can frame.
const LINE_URL = "moz-extension://me/cmdline.html";
const SIDEBAR_URL = "moz-extension://me/sidebar.html";
const win = (id: number, extra: Partial<WindowLike> = {}): WindowLike => ({ id, type: "normal", incognito: false, ...extra });

type Options = {
  windows?: WindowLike[];
  containers?: Map<string, ContainerIdentity>;
  previous?: Record<number, number>;
  groups?: Group[];
  is_opener?: (tab_id: number, frame_id: number) => Promise<boolean>;
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
  const opener_asks: string[] = [];
  let connect: (port: TabModelPort) => void = () => {};
  let timers: Array<{ id: number; fn: () => void }> = [];
  let next_timer = 1;
  let tabs = initial;
  let groups: Group[] = options.groups ?? [];
  let fail_groups = false;
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
    groups: async () => {
      if (fail_groups) throw new Error("no groups");
      return groups.map((g) => ({ ...g }));
    },
    group_events: events_named("groups.") as unknown as TabModelDeps["group_events"],
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
    is_web_accessible_page: (port) => port.sender?.url === LINE_URL,
    is_opener: (tab_id, frame_id) => {
      opener_asks.push(`${tab_id}:${frame_id}`);
      return options.is_opener ? options.is_opener(tab_id, frame_id) : Promise.resolve(true);
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
  // By default a port is the command line page in tab 7, frame 3, so it goes through the ticket check.
  const connect_port_now = (options: { incognito?: boolean; url?: string; name?: string; no_sender_tab?: true; tab_id?: number | "none"; frame_id?: number | "none" } = {}) => {
    const sent: TabModelMessage[] = [];
    const messages = sent as unknown as Record<0 | 1 | 2 | 3, TabModelMessage> & { length: number };
    let on_message: (m: unknown) => void = () => {};
    let on_disconnect = () => {};
    let closed = false;
    const tab_id = options.tab_id === "none" ? {} : { id: options.tab_id ?? 7 };
    const port: TabModelPort = {
      name: options.name ?? "desertfox_tab_model",
      sender: {
        url: options.url ?? LINE_URL,
        ...(options.frame_id === "none" ? {} : { frameId: options.frame_id ?? 3 }),
        ...(options.no_sender_tab ? {} : { tab: { ...tab_id, incognito: options.incognito ?? false } }),
      },
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
    set_groups: (g: Group[]) => void (groups = g),
    fail_groups: (fails: boolean) => void (fail_groups = fails),
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

test("an unload of a still-loading tab keeps the row's title and address, though the update reads about:blank", async () => {
  const f = make([tab(1, 1, 0, { title: "Mail", url: "https://mail.test/" })]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onUpdated", 1, { discarded: true }, tab(1, 1, 0, { title: "", url: "about:blank", discarded: true }));
  f.run_timers();
  const patch = p.messages[1];
  const row = patch?.type === "patch" ? patch.upserts[0] : undefined;
  assert.deepEqual([row?.discarded, row?.title, row?.url, row?.site], [true, "Mail", "https://mail.test/", "mail.test"]);
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
  // Firefox leaves the moving tab out of this list, so the new port's reconcile keeps it detached.
  f.set_tabs([tab(2, 1, 0)]);
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
  f.set_tabs([tab(1, 1, 0), tab(2, 1, 1)]);
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

test("resync queries Firefox again and sends a fresh snapshot at the port's current rev", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.set_tabs([tab(1, 1, 0, { title: "z" })]);
  f.run_timers();
  const queries = f.query_calls();
  p.send({ type: "resync" });
  await tick();
  assert.equal(f.query_calls(), queries + 1);
  const snap = p.messages[2];
  assert.ok(snap.type === "snapshot");
  assert.equal(snap.rev, 1);
  assert.equal(snap.tabs[0]?.title, "z");
  p.send({ type: "nonsense" });
  await tick();
  assert.equal(p.messages.length, 3);
});

test("settled flushes pending changes now, and neither it nor start queries again", async () => {
  const f = make([tab(1, 1, 0)]);
  await f.model.start();
  const p = await f.connect_port();
  const queries = f.query_calls();
  f.fire("onCreated", tab(2, 1, 1));
  await f.model.settled();
  await f.model.start();
  assert.equal(f.query_calls(), queries);
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
  const priv = await f.connect_port({ name: "desertfox_tab_model:private", no_sender_tab: true, url: SIDEBAR_URL });
  const normal = await f.connect_port({ name: "desertfox_tab_model:normal", no_sender_tab: true, url: SIDEBAR_URL });
  const silent = await f.connect_port({ no_sender_tab: true, url: SIDEBAR_URL });
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

test("a command line port from a tab with no ticket is closed and never gets a snapshot or a patch", async () => {
  const f = make([tab(1, 1, 0)], { is_opener: async () => false });
  await f.model.start();
  const p = await f.connect_port({ tab_id: 7 });
  assert.deepEqual([p.messages.length, p.closed(), f.opener_asks], [0, true, ["7:3"]]);
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  p.send({ type: "resync" });
  assert.equal(p.messages.length, 0);
});

test("a second command line page framed in the line's own tab cannot connect, and the line itself can", async () => {
  // A page frames its own copy of cmdline.html while the user's line (frame 3) is open in the same tab.
  const f = make([tab(1, 1, 0)], { is_opener: async (tab_id, frame_id) => tab_id === 7 && frame_id === 3 });
  await f.model.start();
  const framed = await f.connect_port({ tab_id: 7, frame_id: 12 });
  const line = await f.connect_port({ tab_id: 7, frame_id: 3 });
  assert.deepEqual([framed.messages.length, framed.closed()], [0, true]);
  assert.deepEqual([line.closed(), line.messages[0].type], [false, "snapshot"]);
});

test("a command line page with no sender tab or frame id, or whose ticket check fails, is closed", async () => {
  // A web panel in the sidebar can frame cmdline.html too, and that frame has no sender tab.
  const f = make([tab(1, 1, 0)], { is_opener: async () => Promise.reject(new Error("storage gone")) });
  await f.model.start();
  const no_tab = await f.connect_port({ no_sender_tab: true });
  const no_tab_id = await f.connect_port({ tab_id: "none" });
  const no_frame = await f.connect_port({ frame_id: "none" });
  const failed = await f.connect_port();
  for (const p of [no_tab, no_tab_id, no_frame, failed]) assert.deepEqual([p.messages.length, p.closed()], [0, true]);
  assert.deepEqual(f.opener_asks, ["7:3"]);
});

test("a ticketed port gets its snapshot and then patches, and an extension page no web page can frame skips the check", async () => {
  const f = make([tab(1, 1, 0)], { is_opener: async (tab_id) => tab_id === 7 });
  await f.model.start();
  const p = await f.connect_port({ tab_id: 7 });
  const sidebar = await f.connect_port({ name: "desertfox_tab_model:normal", no_sender_tab: true, url: SIDEBAR_URL });
  const help_tab = await f.connect_port({ tab_id: 4, url: "moz-extension://me/home.html" });
  assert.deepEqual(f.opener_asks, ["7:3"]);
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.run_timers();
  assert.deepEqual([p.closed(), p.messages[0].type, pick(p.messages[1], "title")], [false, "snapshot", [[1, "z"]]]);
  assert.deepEqual([sidebar.messages.length, help_tab.messages.length], [2, 2]);
});

test("a slow ticket check holds back every message, and the snapshot then holds the change", async () => {
  const check = gate();
  const f = make([tab(1, 1, 0)], { is_opener: async () => check.promise.then(() => true) });
  await f.model.start();
  const p = f.connect_port_now();
  f.fire("onUpdated", 1, { title: "z" }, tab(1, 1, 0, { title: "z" }));
  f.set_tabs([tab(1, 1, 0, { title: "z" })]);
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
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => store.delete(key)),
  };
  let next = 0;
  const cmdline = create_cmdline_service({
    storage: storage as never,
    tickets: storage as never,
    new_ticket: () => `ticket-${++next}`,
    sources: async () => ({ search_engines: [], containers: [] }),
    container_stores: async () => [],
    page_config: async () => ({ commands: [], help_ids: [], command_aliases: {}, prompt: ":", all_windows: false }) as never,
    tab_count: async () => 1,
  });
  const f = make([tab(1, 1, 0)], { is_opener: cmdline.is_opener });
  await f.model.start();

  assert.ok((await f.connect_port({ tab_id: 7 })).closed(), "no ticket");
  assert.equal(await cmdline.open("guessed", 7, 3, 10), undefined);
  assert.ok((await f.connect_port({ tab_id: 7 })).closed(), "a wrong ticket");

  const ticket = await cmdline.issue_ticket(8);
  assert.ok(await cmdline.open(ticket, 8, 3, 10));
  assert.equal(await cmdline.open(ticket, 9, 3, 10), undefined);
  const reused = await f.connect_port({ tab_id: 9 });
  assert.deepEqual([reused.closed(), reused.messages.length], [true, 0], "a reused ticket");

  const line = await f.connect_port({ tab_id: 8 });
  assert.deepEqual([line.closed(), line.messages[0].type], [false, "snapshot"], "the real line");
  assert.ok((await f.connect_port({ tab_id: 8, frame_id: 12 })).closed(), "another frame of the line's tab");
  // The next line mounts a new frame, so the closed line's frame id no longer passes.
  assert.ok(await cmdline.open(await cmdline.issue_ticket(8), 8, 4, 10));
  assert.ok((await f.connect_port({ tab_id: 8, frame_id: 3 })).closed(), "the closed line");
  assert.equal((await f.connect_port({ tab_id: 8, frame_id: 4 })).closed(), false, "the next line");
  await cmdline.forget_opener_on_navigation(8, { status: "loading" });
  assert.ok((await f.connect_port({ tab_id: 8, frame_id: 4 })).closed(), "the tab navigated away");
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
  f.set_tabs([tab(3, 1, 0, { active: true })]);
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
  f.set_tabs([tab(1, 1, 0, { active: true }), tab(2, 1, 1)]);
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

test("a container re-read while a tab is detached reaches the row when it attaches", async () => {
  const f = make([tab(1, 1, 0, { cookieStoreId: "firefox-container-1" }), tab(2, 2, 0)], { containers: new Map([["firefox-container-1", WORK]]) });
  await f.model.start();
  const p = await f.connect_port();
  f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
  f.set_containers(new Map([["firefox-container-1", { ...WORK, name: "Job" }]]));
  f.fire("containers.onUpdated", {});
  await tick();
  f.fire("onAttached", 1, { newWindowId: 2, newPosition: 1 });
  f.run_timers();
  assert.deepEqual(pick(p.messages[1], "container_name"), [[1, "Job"]]);
});

test("with containers off every row has empty container marks", async () => {
  const f = make([tab(1, 1, 0, { cookieStoreId: "firefox-container-1" })]);
  f.set_containers("off");
  await f.model.start();
  const p = await f.connect_port();
  assert.deepEqual(pick(p.messages[0], "container_name"), [[1, ""]]);
  // The load and the reconcile at connect, and no retry for the failed container read.
  assert.equal(f.query_calls(), 2);
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

describe("reconcile against Firefox", () => {
  const abc = () => [tab(1, 1, 0), tab(2, 1, 1), tab(3, 1, 2)];
  const resync = async (p: Awaited<ReturnType<ReturnType<typeof make>["connect_port"]>>) => {
    p.send({ type: "resync" });
    await tick();
  };
  const last = (messages: { length: number }) => (messages as unknown as TabModelMessage[])[messages.length - 1] as TabModelMessage;

  test("resync repairs a stale create with a patch, then sends the snapshot", async () => {
    const f = make(abc());
    await f.model.start();
    const p = await f.connect_port();
    f.fire("onCreated", tab(4, 1, 1));
    f.run_timers();
    f.set_tabs([...abc(), tab(4, 1, 3)]);
    await resync(p);
    const patch = p.messages[2];
    assert.ok(patch.type === "patch");
    assert.deepEqual(patch.upserts.map((r) => `${r.id}:${r.index}`).sort(), ["2:1", "3:2", "4:3"]);
    assert.deepEqual(order(p.messages[3]), ["1:0:1", "1:1:2", "1:2:3", "1:3:4"]);
    assert.equal(p.messages[3].type === "snapshot" && p.messages[3].rev, 2);
  });

  test("resync adds a tab no event announced and drops a tab whose removal was missed", async () => {
    const f = make(abc());
    await f.model.start();
    const p = await f.connect_port();
    f.set_tabs([tab(1, 1, 0), tab(3, 1, 1), tab(5, 1, 2)]);
    await resync(p);
    const patch = p.messages[1];
    assert.ok(patch.type === "patch");
    assert.deepEqual(patch.removed, [2]);
    assert.deepEqual(patch.upserts.map((r) => `${r.id}:${r.index}`).sort(), ["3:1", "5:2"]);
    assert.deepEqual(order(p.messages[2]), ["1:0:1", "1:1:3", "1:2:5"]);
  });

  test("resync with no drift sends only the snapshot", async () => {
    const f = make(abc());
    await f.model.start();
    const p = await f.connect_port();
    await resync(p);
    assert.equal(p.messages.length, 2);
    assert.equal(p.messages[1].type, "snapshot");
  });

  test("a new port triggers the repair, and an open port gets it as a patch", async () => {
    const f = make(abc());
    await f.model.start();
    const early = await f.connect_port();
    f.set_tabs([tab(2, 1, 0), tab(1, 1, 1), tab(3, 1, 2)]);
    const late = await f.connect_port();
    assert.deepEqual(order(late.messages[0]), ["1:0:2", "1:1:1", "1:2:3"]);
    assert.deepEqual(early.messages[1] && ids(early.messages[1]).sort(), [1, 2]);
  });

  test("the model's previous mark and active tab survive a repair", async () => {
    const f = make([tab(1, 1, 0, { active: true }), tab(2, 1, 1), tab(3, 1, 2)], { previous: { 1: 2 } });
    await f.model.start();
    const p = await f.connect_port();
    f.fire("onActivated", { tabId: 3, windowId: 1, previousTabId: 1 });
    f.set_tabs([tab(1, 1, 0), tab(2, 1, 1, { title: "new" }), tab(3, 1, 2, { active: true })]);
    await resync(p);
    assert.deepEqual(pick(last(p.messages), "previous"), [[1, true], [2, false], [3, false]]);
    assert.deepEqual(pick(last(p.messages), "title"), [[1, "t1"], [2, "new"], [3, "t3"]]);
  });

  for (const [name, fire_event, after] of [
    ["onCreated", (f: ReturnType<typeof make>) => f.fire("onCreated", tab(4, 1, 3)), [...abc(), tab(4, 1, 3)]],
    ["onMoved", (f: ReturnType<typeof make>) => f.fire("onMoved", 1, { windowId: 1, fromIndex: 0, toIndex: 2 }), [tab(2, 1, 0), tab(3, 1, 1), tab(1, 1, 2)]],
    ["onRemoved", (f: ReturnType<typeof make>) => f.fire("onRemoved", 2, { windowId: 1, isWindowClosing: false }), [tab(1, 1, 0), tab(3, 1, 1)]],
  ] as const) {
    test(`an ${name} during the query discards the answer and queries again`, async () => {
      const f = make(abc());
      await f.model.start();
      const p = await f.connect_port();
      const queries = f.query_calls();
      const release = f.hold_query();
      p.send({ type: "resync" });
      fire_event(f);
      f.set_tabs([...after]);
      release();
      await tick();
      assert.equal(f.query_calls(), queries + 2);
      assert.deepEqual(order(last(p.messages)), after.map((t) => `${t.windowId}:${t.index}:${t.id}`).sort());
    });
  }

  test("a reconcile that sees an event during every query gives up and leaves the event-built rows", async () => {
    const f = make(abc());
    await f.model.start();
    const p = await f.connect_port();
    const queries = f.query_calls();
    let release = f.hold_query();
    p.send({ type: "resync" });
    for (const title of ["a", "b", "c"]) {
      f.fire("onUpdated", 1, { title }, tab(1, 1, 0, { title }));
      // The retry starts only after this turn, so the new hold catches it.
      release();
      release = f.hold_query();
      await tick();
    }
    release();
    await tick();
    assert.equal(f.query_calls(), queries + 3);
    assert.deepEqual(pick(last(p.messages), "title"), [[1, "c"], [2, "t2"], [3, "t3"]]);
  });

  test("a failed query still answers resync with a snapshot", async () => {
    const f = make(abc());
    await f.model.start();
    const p = await f.connect_port();
    f.fail_next_query();
    await resync(p);
    assert.deepEqual(order(last(p.messages)), ["1:0:1", "1:1:2", "1:2:3"]);
  });

  test("overlapping reconciles apply only the newest answer, and both ports get it", async () => {
    const f = make(abc());
    await f.model.start();
    const p = await f.connect_port();
    const queries = f.query_calls();
    const release_older = f.hold_query();
    f.set_tabs([tab(1, 1, 0), tab(2, 1, 1)]);
    p.send({ type: "resync" });
    const release_newer = f.hold_query();
    f.set_tabs([tab(2, 1, 0), tab(1, 1, 1)]);
    const late = f.connect_port_now();
    await tick();
    release_older();
    await tick();
    assert.equal(p.messages.length, 1, "the older resync waits for the newer answer");
    release_newer();
    await tick();
    assert.equal(f.query_calls(), queries + 2);
    const patches = (p.messages as unknown as TabModelMessage[]).filter((m) => m.type === "patch");
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]?.type === "patch" && patches[0].removed, [3]);
    assert.deepEqual(order(last(p.messages)), ["1:0:2", "1:1:1"]);
    assert.deepEqual(order(late.messages[0]), ["1:0:2", "1:1:1"]);
  });

  test("a port that connects during the startup load gets the load's snapshot and no extra query", async () => {
    const f = make(abc());
    const release = f.hold_query();
    const started = f.model.start();
    const p = await f.connect_port();
    p.send({ type: "resync" });
    release();
    await started;
    await tick();
    assert.equal(f.query_calls(), 1);
    assert.equal(p.messages.length, 1);
    assert.deepEqual(order(p.messages[0]), ["1:0:1", "1:1:2", "1:2:3"]);
  });

  test("a tab detached during the query is adopted at its listed place, and the attach keeps it there and active", async () => {
    const f = make([...abc(), tab(4, 2, 0, { active: true })]);
    await f.model.start();
    const p = await f.connect_port();
    const release = f.hold_query();
    p.send({ type: "resync" });
    f.fire("onDetached", 2, { oldWindowId: 1, oldPosition: 1 });
    f.set_tabs([tab(1, 1, 0), tab(3, 1, 1), tab(4, 2, 0), tab(2, 2, 1, { active: true })]);
    release();
    await tick();
    assert.deepEqual(order(last(p.messages)), ["1:0:1", "1:1:3", "2:0:4", "2:1:2"]);
    f.fire("onAttached", 2, { newWindowId: 2, newPosition: 1 });
    f.run_timers();
    const patch = last(p.messages);
    assert.ok(patch.type === "patch");
    assert.deepEqual(patch.upserts.map((r) => `${r.window_id}:${r.index}:${r.id}:${r.active}`), ["2:1:2:true"]);
  });

  test("a tab whose attach was missed comes back on the next resync", async () => {
    const f = make([...abc(), tab(4, 2, 0)]);
    await f.model.start();
    const p = await f.connect_port();
    f.fire("onDetached", 2, { oldWindowId: 1, oldPosition: 1 });
    f.run_timers();
    f.set_tabs([tab(1, 1, 0), tab(3, 1, 1), tab(4, 2, 0), tab(2, 2, 1)]);
    await resync(p);
    assert.deepEqual(order(last(p.messages)), ["1:0:1", "1:1:3", "2:0:4", "2:1:2"]);
  });

  test("a repair keeps the address of a tab unloaded while it still loads", async () => {
    const f = make([tab(1, 1, 0, { title: "Mail", url: "https://mail.test/" })]);
    await f.model.start();
    const p = await f.connect_port();
    f.set_tabs([tab(1, 1, 0, { title: "", url: "about:blank", discarded: true })]);
    await resync(p);
    const row = rows_of(last(p.messages))[0];
    assert.deepEqual([row?.discarded, row?.title, row?.url, row?.site], [true, "Mail", "https://mail.test/", "mail.test"]);
  });

  test("a repair numbers a window whose creation event was missed", async () => {
    const f = make([tab(1, 1, 0)]);
    await f.model.start();
    const p = await f.connect_port();
    f.set_windows([win(1), win(2)]);
    f.set_tabs([tab(1, 1, 0), tab(2, 2, 0)]);
    await resync(p);
    assert.deepEqual(pick(last(p.messages), "window_number"), [[1, 1], [2, 2]]);
  });

  test("a window event during the reconcile's window read discards the answer and reads again", async () => {
    const f = make([tab(1, 1, 0)]);
    await f.model.start();
    const p = await f.connect_port();
    const queries = f.query_calls();
    const release = f.hold_windows();
    p.send({ type: "resync" });
    f.set_windows([win(1), win(2)]);
    f.set_tabs([tab(1, 1, 0), tab(2, 2, 0)]);
    f.fire("windows.onCreated", {});
    release();
    await tick();
    assert.equal(f.query_calls(), queries + 2);
    assert.deepEqual(pick(last(p.messages), "window_number"), [[1, 1], [2, 2]]);
  });

  test("a repair relabels a container whose rename event was missed", async () => {
    const f = make([tab(1, 1, 0, { cookieStoreId: "firefox-container-1" })], { containers: new Map([["firefox-container-1", WORK]]) });
    await f.model.start();
    const p = await f.connect_port();
    f.set_containers(new Map([["firefox-container-1", { ...WORK, name: "Job" }]]));
    await resync(p);
    assert.deepEqual(pick(last(p.messages), "container_name"), [[1, "Job"]]);
  });

  test("a detached tab whose container rename was missed attaches with the new name after a repair", async () => {
    const f = make([tab(1, 1, 0, { cookieStoreId: "firefox-container-1" }), tab(2, 2, 0)], { containers: new Map([["firefox-container-1", WORK]]) });
    await f.model.start();
    const p = await f.connect_port();
    f.fire("onDetached", 1, { oldWindowId: 1, oldPosition: 0 });
    f.run_timers();
    // Firefox leaves the moving tab out of this list, so it stays detached through the repair.
    f.set_tabs([tab(2, 2, 0)]);
    f.set_containers(new Map([["firefox-container-1", { ...WORK, name: "Job" }]]));
    await resync(p);
    f.fire("onAttached", 1, { newWindowId: 2, newPosition: 1 });
    f.run_timers();
    assert.deepEqual(pick(last(p.messages), "container_name"), [[1, "Job"]]);
  });

  test("a repair that makes the previous tab active clears its previous mark", async () => {
    const f = make([tab(1, 1, 0, { active: true }), tab(2, 1, 1)], { previous: { 1: 2 } });
    await f.model.start();
    const p = await f.connect_port();
    f.set_tabs([tab(1, 1, 0), tab(2, 1, 1, { active: true })]);
    await resync(p);
    assert.deepEqual(pick(last(p.messages), "previous"), [[1, false], [2, false]]);
    assert.deepEqual(pick(last(p.messages), "active"), [[1, false], [2, true]]);
  });
});

describe("native tab groups", () => {
  const group = (id: number, window_id: number, extra: Partial<Group> = {}): Group => ({ id, windowId: window_id, title: `g${id}`, color: "blue", collapsed: false, ...extra });
  const patch_of = (m: TabModelMessage | undefined) => {
    assert.equal(m?.type, "patch");
    return m as Extract<TabModelMessage, { type: "patch" }>;
  };

  test("the snapshot carries each tab's group id and the groups table, a tab in no group is -1", async () => {
    const f = make([tab(1, 1, 0, { groupId: 5 }), tab(2, 1, 1)], { groups: [group(5, 1, { title: "Work", collapsed: true })] });
    await f.model.start();
    const p = await f.connect_port();
    const snapshot = p.messages[0];
    assert.equal(snapshot?.type, "snapshot");
    if (snapshot?.type !== "snapshot") return;
    assert.deepEqual(snapshot.tabs.map((row) => row.group_id), [5, -1]);
    assert.deepEqual(snapshot.groups, [{ id: 5, window_id: 1, title: "Work", color: "blue", collapsed: true }]);
  });

  test("a created group patches the table and sends no tab rows", async () => {
    const f = make([tab(1, 1, 0)]);
    await f.model.start();
    const p = await f.connect_port();
    f.fire("groups.onCreated", group(7, 1, { title: "New" }));
    f.run_timers();
    const patch = patch_of(p.messages[1]);
    assert.deepEqual([patch.upserts, patch.groups?.map((g) => g.title), patch.groups_removed], [[], ["New"], undefined]);
  });

  test("an updated group patches its title and collapsed state, and one that changes nothing sends nothing", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 })], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    f.fire("groups.onUpdated", group(7, 1));
    assert.equal(f.pending_timers(), 0);
    f.fire("groups.onUpdated", group(7, 1, { title: "Renamed", collapsed: true }));
    f.run_timers();
    assert.deepEqual(patch_of(p.messages[1]).groups, [{ id: 7, window_id: 1, title: "Renamed", color: "blue", collapsed: true }]);
  });

  test("a removed group leaves the table and clears the group id of its tabs in the same patch", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 }), tab(2, 1, 1, { groupId: 7 }), tab(3, 1, 2)], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    f.fire("groups.onRemoved", group(7, 1), { isWindowClosing: false });
    f.run_timers();
    const patch = patch_of(p.messages[1]);
    assert.deepEqual(patch.groups_removed, [7]);
    assert.deepEqual(patch.upserts.map((row) => [row.id, row.group_id]), [[1, -1], [2, -1]]);
  });

  test("a tab that leaves its group is one upsert with group id -1, and one that joins carries the new id", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 }), tab(2, 1, 1)], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    f.fire("onUpdated", 1, { groupId: -1 }, tab(1, 1, 0, { groupId: -1 }));
    f.fire("onUpdated", 2, { groupId: 7 }, tab(2, 1, 1, { groupId: 7 }));
    f.run_timers();
    assert.deepEqual(patch_of(p.messages[1]).upserts.map((row) => [row.id, row.group_id]), [[1, -1], [2, 7]]);
  });

  test("a moved group reads the tabs again, so the shifted indexes reach the ports", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 }), tab(2, 1, 1)], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    await tick();
    const before = p.messages.length;
    f.set_tabs([tab(2, 1, 0), tab(1, 1, 1, { groupId: 7 })]);
    f.fire("groups.onMoved", group(7, 1));
    await tick();
    f.run_timers();
    const patch = patch_of((p.messages as unknown as TabModelMessage[])[before]);
    assert.deepEqual(patch.upserts.map((row) => [row.id, row.index]).sort(), [[1, 1], [2, 0]]);
  });

  test("a resync repairs a group event that was missed", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 })], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    f.set_groups([group(8, 1, { title: "Other" })]);
    f.set_tabs([tab(1, 1, 0, { groupId: 8 })]);
    p.send({ type: "resync" });
    await tick();
    await tick();
    const last = (p.messages as unknown as TabModelMessage[]).at(-1);
    assert.equal(last?.type === "snapshot" && last.groups.map((g) => g.id).join(), "8");
  });

  test("a private port sees only the groups of private windows", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 }), tab(2, 2, 0, { groupId: 8, incognito: true })], { groups: [group(7, 1), group(8, 2)] });
    await f.model.start();
    const normal = await f.connect_port({ incognito: false });
    const priv = await f.connect_port({ incognito: true });
    const ids_of = (m: TabModelMessage | undefined) => (m?.type === "snapshot" ? m.groups.map((g) => g.id) : []);
    assert.deepEqual([ids_of(normal.messages[0]), ids_of(priv.messages[0])], [[7], [8]]);
    f.fire("groups.onUpdated", group(8, 2, { title: "x" }));
    f.run_timers();
    assert.equal(normal.messages.length, 1);
    assert.equal(patch_of(priv.messages[1]).groups?.[0]?.id, 8);
  });

  test("a tab that closes in the same batch as its group's removal sends the removal and no row for it", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 }), tab(2, 1, 1, { groupId: 7 })], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    f.fire("onRemoved", 2, { windowId: 1, isWindowClosing: false });
    f.fire("groups.onRemoved", group(7, 1), { isWindowClosing: false });
    f.run_timers();
    const patch = patch_of((p.messages as unknown as TabModelMessage[])[1]);
    assert.deepEqual([patch.removed, patch.groups_removed, patch.upserts.map((row) => [row.id, row.group_id])], [[2], [7], [[1, -1]]]);
  });

  test("a stale tab update after its group was removed keeps the tab out of the dead group", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 })], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    f.fire("groups.onRemoved", group(7, 1), { isWindowClosing: false });
    f.fire("onUpdated", 1, { title: "x" }, tab(1, 1, 0, { groupId: 7, title: "x" }));
    f.run_timers();
    const patch = patch_of((p.messages as unknown as TabModelMessage[])[1]);
    assert.deepEqual(patch.upserts.map((row) => [row.id, row.group_id]), [[1, -1]]);
  });

  test("a group of a window with no tab row yet is sent once the first tab row arrives", async () => {
    const f = make([tab(1, 1, 0)]);
    await f.model.start();
    const p = await f.connect_port();
    f.fire("groups.onCreated", group(9, 2));
    f.run_timers();
    assert.equal(p.messages.length, 1);
    f.set_tabs([tab(1, 1, 0), tab(5, 2, 0, { groupId: 9 })]);
    f.set_groups([group(9, 2)]);
    f.fire("onCreated", tab(5, 2, 0, { groupId: 9 }));
    f.run_timers();
    const patch = patch_of((p.messages as unknown as TabModelMessage[])[1]);
    assert.deepEqual(patch.groups?.map((g) => g.id), [9]);
  });

  test("a failed group read in a resync keeps the groups the model has", async () => {
    const f = make([tab(1, 1, 0, { groupId: 7 })], { groups: [group(7, 1)] });
    await f.model.start();
    const p = await f.connect_port();
    await tick();
    f.fail_groups(true);
    p.send({ type: "resync" });
    await tick();
    await tick();
    const last = (p.messages as unknown as TabModelMessage[]).at(-1);
    assert.equal(last?.type === "snapshot" && last.groups.map((g) => g.id).join(), "7");
  });
});
