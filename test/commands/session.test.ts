import assert from "node:assert/strict";
import { test } from "node:test";
import { make_session_handlers } from "../../src/commands/session.ts";
import type { LiveTab, OpenTab, SessionDeps } from "../../src/commands/session.ts";
import { make_session_store } from "../../src/background/session_store.ts";
import type { SessionStorage } from "../../src/background/session_store.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { CommandContext } from "../../src/shared/command.ts";

type FakeTab = { id: number; url: string; title: string; pinned: boolean; active: boolean; discarded: boolean; cookie_store_id: string };

// A small browser: windows hold tabs in order, and the calls refuse what Firefox refuses.
function make_fake({ containers = [] as { id: string; name: string }[], private_window = false, store_fails = false } = {}) {
  const stored = new Map<string, unknown>();
  const storage: SessionStorage = {
    get: async (key) => structuredClone(stored.get(key)),
    set: async (key, value) => {
      if (store_fails) throw new Error("QuotaExceededError");
      stored.set(key, structuredClone(value));
    },
  };
  const windows = new Map<number, FakeTab[]>();
  const log: string[] = [];
  const toasts: { kind: string; message: string }[] = [];
  const toast_tabs: (number | undefined)[] = [];
  let next_id = 1000;
  // Holds every create_tab until released, so a test can act while a restore is in flight.
  const gate = { wait: undefined as Promise<void> | undefined };
  const store = make_session_store(storage, () => 1_000);
  const deps: SessionDeps = {
    store,
    is_private: async () => private_window,
    window_tabs: async (window_id) =>
      (windows.get(window_id) ?? []).map((tab, index): LiveTab => ({ index, url: tab.url, title: tab.title, pinned: tab.pinned, active: tab.active, cookie_store_id: tab.cookie_store_id })),
    containers: async () => containers,
    create_window: async () => {
      log.push("window");
      const window_id = ++next_id;
      const blank: FakeTab = { id: ++next_id, url: "about:blank", title: "", pinned: false, active: true, discarded: false, cookie_store_id: "firefox-default" };
      windows.set(window_id, [blank]);
      return { window_id, blank_tab_id: blank.id };
    },
    window_exists: async (window_id) => windows.has(window_id),
    create_tab: async (open: OpenTab) => {
      await gate.wait;
      if (open.pinned && open.discarded) throw new Error("Pinned tabs cannot be created and discarded.");
      if (/^(about:config|file:)/.test(open.url)) throw new Error(`Illegal URL: ${open.url}`);
      const tabs = windows.get(open.window_id);
      if (!tabs) throw new Error("No window with id");
      const tab: FakeTab = { id: ++next_id, url: open.url, title: open.title, pinned: open.pinned, active: open.active, discarded: open.discarded, cookie_store_id: open.cookie_store_id ?? "firefox-default" };
      if (open.active) tabs.forEach((other) => (other.active = false));
      tabs.splice(Math.min(open.index ?? tabs.length, tabs.length), 0, tab);
      return tab.id;
    },
    set_pinned: async (tab_id, pinned) => {
      for (const tabs of windows.values()) tabs.filter((tab) => tab.id === tab_id).forEach((tab) => (tab.pinned = pinned));
    },
    activate: async (tab_id) => {
      log.push(`activate ${tab_id}`);
      for (const tabs of windows.values()) if (tabs.some((tab) => tab.id === tab_id)) tabs.forEach((tab) => ((tab.active = tab.id === tab_id), tab.id === tab_id && (tab.discarded = false)));
    },
    remove_tab: async (tab_id) => {
      for (const tabs of windows.values()) {
        const at = tabs.findIndex((tab) => tab.id === tab_id);
        if (at !== -1) tabs.splice(at, 1);
      }
    },
    close_window: async (window_id) => void windows.delete(window_id),
    toast: async (toast_ctx, kind, message) => (toasts.push({ kind, message }), void toast_tabs.push(toast_ctx.tab_id)),
  };
  const add_window = (window_id: number, tabs: Partial<FakeTab>[]) =>
    windows.set(
      window_id,
      tabs.map((tab, index) => ({ id: window_id * 100 + index, url: `https://t${index}.test/`, title: `Tab ${index}`, pinned: false, active: tabs.some((other) => other.active) ? false : index === 0, discarded: false, cookie_store_id: "firefox-default", ...tab })),
    );
  return { handlers: make_session_handlers(deps), deps, store, windows, log, toasts, toast_tabs, gate, add_window };
}

const ctx = (window_id: number): CommandContext => ({ tab_id: window_id * 100, window_id, frame_id: 0, mode: "normal" });

test("save stores the window's tabs in order with container names, and toasts the count", async () => {
  const fake = make_fake({ containers: [{ id: "firefox-container-1", name: "Work" }] });
  fake.add_window(1, [{}, { pinned: true, active: true }, { cookie_store_id: "firefox-container-1" }, { url: "" }]);
  await fake.handlers.save(ctx(1), { name: "day" });
  const saved = await fake.store.get("day");
  assert.deepEqual(saved.tabs.map((tab) => [tab.url, tab.pinned, tab.active, tab.container_id, tab.container_name]), [
    ["https://t0.test/", false, false, undefined, undefined],
    ["https://t1.test/", true, true, undefined, undefined],
    ["https://t2.test/", false, false, "firefox-container-1", "Work"],
  ]);
  assert.deepEqual(fake.toasts, [{ kind: "success", message: 'Saved "day": 3 tabs' }]);
});

test("saving an existing name updates it and the toast gives both counts", async () => {
  const fake = make_fake();
  fake.add_window(1, [{}, {}]);
  await fake.handlers.save(ctx(1), { name: "Day" });
  fake.add_window(1, [{}, {}, {}, {}, {}]);
  await fake.handlers.save(ctx(1), { name: "day" });
  assert.equal(fake.toasts[1]?.message, 'Updated "Day": 5 tabs, was 2');
  assert.equal((await fake.store.list()).length, 1);
});

test("a tab that closes after the save read it stays saved, and a container lookup that fails saves no container name", async () => {
  const fake = make_fake();
  fake.add_window(1, [{ cookie_store_id: "firefox-container-1" }, {}]);
  const read = fake.deps.window_tabs;
  fake.deps.window_tabs = async (window_id) => {
    const tabs = await read(window_id);
    fake.windows.get(window_id)?.pop();
    return tabs;
  };
  await fake.handlers.save(ctx(1), { name: "x" });
  const saved = await fake.store.get("x");
  assert.equal(saved.tabs.length, 2);
  assert.deepEqual([saved.tabs[0]?.container_id, saved.tabs[0]?.container_name], ["firefox-container-1", undefined]);
});

test("save refuses a window with no tab address, a private window and a full store", async () => {
  const empty = make_fake();
  empty.add_window(1, [{ url: "" }]);
  await assert.rejects(empty.handlers.save(ctx(1), { name: "x" }), /No tabs to save/);

  const private_fake = make_fake({ private_window: true });
  private_fake.add_window(1, [{}]);
  for (const act of [
    () => private_fake.handlers.save(ctx(1), { name: "x" }),
    () => private_fake.handlers.open(ctx(1), { name: "x", into: "window" }),
    () => private_fake.handlers.remove(ctx(1), { name: "x" }),
    () => private_fake.handlers.rename(ctx(1), { name: "x", to: "y" }),
  ]) await assert.rejects(act(), /not available in private windows/);

  const full = make_fake({ store_fails: true });
  full.add_window(1, [{}]);
  await assert.rejects(full.handlers.save(ctx(1), { name: "x" }), /Could not store the sessions: QuotaExceededError/);
  assert.deepEqual(full.toasts, []);
});

async function saved_session(fake: ReturnType<typeof make_fake>, name: string, tabs: Partial<FakeTab>[]) {
  fake.add_window(1, tabs);
  await fake.handlers.save(ctx(1), { name });
}

test("open in a new window creates the tabs in order, discarded but the active one, and removes the blank tab", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{ title: "A" }, { title: "B", active: true }, { title: "C", pinned: false }]);
  fake.windows.delete(1);
  await fake.handlers.open(ctx(2), { name: "S", into: "window" });
  const tabs = [...fake.windows][0]?.[1];
  assert.deepEqual(tabs?.map((tab) => [tab.url, tab.discarded, tab.active]), [
    ["https://t0.test/", true, false],
    ["https://t1.test/", false, true],
    ["https://t2.test/", true, false],
  ]);
  assert.deepEqual(tabs?.map((tab) => tab.title), ["A", "B", "C"]);
  assert.deepEqual(fake.toasts.at(-1), { kind: "success", message: 'Opened "s": 3 tabs' });
});

test("a pinned background tab is created unpinned and pinned after, and a pinned active tab is created pinned", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{ pinned: true }, { pinned: true, active: true }, {}]);
  fake.windows.delete(1);
  await fake.handlers.open(ctx(2), { name: "s", into: "window" });
  const tabs = [...fake.windows][0]?.[1];
  assert.deepEqual(tabs?.map((tab) => [tab.pinned, tab.discarded]), [[true, true], [true, false], [false, true]]);
});

test("open with into tab appends every tab discarded and leaves the current tab active", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{}, { active: true }, { pinned: true }]);
  fake.add_window(5, [{}, {}, {}]);
  await fake.handlers.open(ctx(5), { name: "s", into: "tab" });
  assert.equal(fake.log.includes("window"), false);
  const tabs = fake.windows.get(5) ?? [];
  assert.equal(tabs.length, 6);
  assert.deepEqual(tabs.slice(3).map((tab) => [tab.discarded, tab.active]), [[true, false], [true, false], [true, false]]);
  assert.equal(tabs[0]?.active, true);
  assert.equal(tabs.slice(3).find((tab) => tab.url === "https://t2.test/")?.pinned, true);
  assert.equal(fake.log.some((entry) => entry.startsWith("activate")), false);
});

test("a new window's toast goes on a tab of that window, and into tab keeps it on the command's tab", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{ url: "about:config" }, { url: "https://a.test/", active: true }]);
  await fake.handlers.open(ctx(1), { name: "s", into: "window" });
  const new_tab = [...fake.windows].find(([id]) => id !== 1)?.[1][0]?.id;
  assert.equal(fake.toast_tabs.at(-1), new_tab);
  await fake.handlers.open(ctx(1), { name: "s", into: "tab" });
  assert.equal(fake.toast_tabs.at(-1), ctx(1).tab_id);
});

test("addresses Firefox refuses are skipped and counted, and the first tab that opened loads when the active one was refused", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{ url: "about:config", active: true }, { url: "https://a.test/" }, { url: "file:///etc/hostname" }, { url: "https://b.test/" }]);
  fake.windows.delete(1);
  await fake.handlers.open(ctx(2), { name: "s", into: "window" });
  const tabs = [...fake.windows][0]?.[1];
  assert.deepEqual(tabs?.map((tab) => [tab.url, tab.active, tab.discarded]), [["https://a.test/", true, false], ["https://b.test/", false, true]]);
  assert.deepEqual(fake.toasts.at(-1), { kind: "warning", message: 'Opened "s": 2 tabs, skipped 2' });
});

// The fake browser takes these, so only the allow-list keeps an imported session from running script or opening another extension's page.
test("a stored address off the allow-list is never handed to the browser, and counts as skipped", async () => {
  (globalThis as unknown as { browser: unknown }).browser = { runtime: { getURL: (path: string) => `moz-extension://own-id/${path}` } };
  const fake = make_fake();
  await saved_session(fake, "s", [{ url: "javascript:alert(1)" }, { url: "https://a.test/", active: true }, { url: "data:text/html,hi" }, { url: "moz-extension://other-id/home.html" }]);
  fake.windows.delete(1);
  await fake.handlers.open(ctx(2), { name: "s", into: "window" });
  const tabs = [...fake.windows][0]?.[1];
  assert.deepEqual(tabs?.map((tab) => tab.url), ["https://a.test/"]);
  assert.deepEqual(fake.toasts.at(-1), { kind: "warning", message: 'Opened "s": 1 tab, skipped 3' });
});

test("when no tab can open the new window closes and the command refuses", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{ url: "about:config" }]);
  fake.windows.delete(1);
  await assert.rejects(fake.handlers.open(ctx(2), { name: "s", into: "window" }), /No tab of "s" could be opened/);
  assert.equal(fake.windows.size, 0);
});

test("a container is kept, found by name when its id changed, and dropped with a note when it is gone", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{ cookie_store_id: "firefox-container-1" }, { cookie_store_id: "firefox-container-2" }, { cookie_store_id: "firefox-container-3" }]);
  fake.windows.delete(1);
  const stored = await fake.store.get("s");
  const names = ["Work", "Shop", "Gone"];
  stored.tabs.forEach((tab, index) => (tab.container_name = names[index] as string));
  await fake.store.save("s", stored.tabs);
  fake.deps.containers = async () => [{ id: "firefox-container-1", name: "Work" }, { id: "firefox-container-8", name: "Shop" }];
  await fake.handlers.open(ctx(2), { name: "s", into: "window" });
  const tabs = [...fake.windows][0]?.[1];
  assert.deepEqual(tabs?.map((tab) => tab.cookie_store_id), ["firefox-container-1", "firefox-container-8", "firefox-default"]);
  assert.match(fake.toasts.at(-1)?.message ?? "", /1 tab lost their container/);
});

test("a save of the same name while a restore is in flight does not change that restore", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{ title: "old 1" }, { title: "old 2" }, { title: "old 3" }]);
  let release!: () => void;
  fake.gate.wait = new Promise((resolve) => (release = resolve));
  const restoring = fake.handlers.open(ctx(2), { name: "s", into: "window" });
  await new Promise((resolve) => setImmediate(resolve));
  fake.add_window(1, [{ title: "new 1" }]);
  await fake.handlers.save(ctx(1), { name: "s" });
  release();
  await restoring;
  const restored = [...fake.windows].find(([id]) => id !== 1)?.[1];
  assert.deepEqual(restored?.map((tab) => tab.title), ["old 1", "old 2", "old 3"]);
  assert.equal((await fake.store.get("s")).tabs.length, 1);
});

test("two restores at once make two windows with every tab each", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{}, {}, {}]);
  let release!: () => void;
  fake.gate.wait = new Promise((resolve) => (release = resolve));
  const first = fake.handlers.open(ctx(1), { name: "s", into: "window" });
  const second = fake.handlers.open(ctx(1), { name: "s", into: "window" });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  const opened = [...fake.windows].filter(([id]) => id !== 1).map(([, tabs]) => tabs.map((tab) => tab.url));
  assert.equal(opened.length, 2);
  for (const urls of opened) assert.deepEqual(urls, ["https://t0.test/", "https://t1.test/", "https://t2.test/"]);
});

test("the new window closing while the restore runs ends the restore and says so", async () => {
  const fake = make_fake();
  await saved_session(fake, "s", [{}, {}]);
  let release!: () => void;
  fake.gate.wait = new Promise((resolve) => (release = resolve));
  const restoring = fake.handlers.open(ctx(1), { name: "s", into: "window" });
  await new Promise((resolve) => setImmediate(resolve));
  for (const id of [...fake.windows.keys()].filter((window_id) => window_id !== 1)) fake.windows.delete(id);
  release();
  await assert.rejects(restoring, /The window closed while "s" was opening/);
});

test("delete and rename change the store and toast", async () => {
  const fake = make_fake();
  await saved_session(fake, "one", [{}]);
  await fake.handlers.rename(ctx(1), { name: "ONE", to: "Two" });
  await fake.handlers.remove(ctx(1), { name: "two" });
  assert.deepEqual(fake.toasts.slice(1), [
    { kind: "success", message: 'Renamed "one" to "Two"' },
    { kind: "success", message: 'Deleted "Two"' },
  ]);
  assert.deepEqual(await fake.store.list(), []);
});

test("the registry accepts the session commands, with into defaulting to window", () => {
  assert.equal(check_args(registry.get("session.save")!, { name: "my work" }, {}).ok, true);
  const open = check_args(registry.get("session.open")!, { name: "my work" }, {});
  assert.equal(open.ok && open.args["into"], "window");
  assert.equal(check_args(registry.get("session.open")!, { name: "x", into: "tab" }, {}).ok, true);
  assert.equal(check_args(registry.get("session.open")!, { name: "x", into: "here" }, {}).ok, false);
  assert.equal(check_args(registry.get("session.delete")!, { name: "x" }, {}).ok, true);
  assert.equal(check_args(registry.get("session.rename")!, { name: "x", to: "y" }, {}).ok, true);
  assert.equal(check_args(registry.get("session.rename")!, { name: "x" }, {}).ok, false);
});

test("the validator refuses a new name that starts with - or @, and lookups take any text", () => {
  const ok = (id: string, args: Record<string, unknown>) => check_args(registry.get(id)!, args, {}).ok;
  for (const name of ["-t", "@selection", "-x y", "  -t"]) {
    assert.equal(ok("session.save", { name }), false, name);
    assert.equal(ok("session.rename", { name: "a", to: name }), false, name);
  }
  for (const name of ["work -t", "Q3 - plan", "a@b"]) {
    assert.equal(ok("session.save", { name }), true, name);
    assert.equal(ok("session.rename", { name: "a", to: name }), true, name);
  }
  assert.equal(ok("session.open", { name: "-t" }), true);
  assert.equal(ok("session.delete", { name: "@x" }), true);
  assert.equal(ok("session.rename", { name: "-old", to: "new" }), true);
});
