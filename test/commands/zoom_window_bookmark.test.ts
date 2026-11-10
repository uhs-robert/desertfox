import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderNode } from "../../src/background/complete_items.ts";
import { make_bookmark_handlers, pick_bookmark, pick_folder } from "../../src/commands/bookmark.ts";
import { open_many } from "../../src/commands/open_target.ts";
import { make_browser_handlers } from "../../src/commands/browser.ts";
import { clamp_zoom, make_zoom_handlers } from "../../src/commands/zoom.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { make_window_handlers } from "../../src/commands/window.ts";
import type { WindowLike } from "../../src/background/complete_items.ts";
import type { CommandContext } from "../../src/shared/command.ts";

const ctx: CommandContext = { tab_id: 7, window_id: 2, frame_id: 0, mode: "normal" };

test("clamp_zoom limits to Firefox bounds and rounds", () => {
  assert.equal(clamp_zoom(0.1), 0.3);
  assert.equal(clamp_zoom(9), 5);
  assert.equal(clamp_zoom(1.1 + 0.1), 1.2);
});

test("zoom.by adds to the current zoom and clamps", async () => {
  const set: number[] = [];
  const handlers = make_zoom_handlers({ get_zoom: async () => 4.9, set_zoom: async (_id, level) => void set.push(level) });
  await handlers.by(ctx, { delta: 0.5 });
  await handlers.set(ctx, { level: 0.1 });
  assert.deepEqual(set, [5, 0.3]);
});

test("window.new turns an empty url into a blank window", async () => {
  const opened: unknown[] = [];
  const handlers = make_window_handlers({
    create: async (open) => void opened.push(open),
    close: async () => {},
    restore_last_closed_window: async () => false,
    windows: async () => [],
    recent_window_ids: async () => [],
    move_tab_to_window: async () => {},
  });
  await handlers.create({ url: "", private: true });
  await handlers.create({ url: "https://a.test/", private: false });
  assert.deepEqual(opened, [
    { url: undefined, private_window: true },
    { url: "https://a.test/", private_window: false },
  ]);
  await assert.rejects(handlers.undo_close(), /no closed window/);
});

test("browser.close_all closes every window", async () => {
  const closed: number[] = [];
  const handlers = make_browser_handlers({
    window_ids: async () => [1, 2, 3],
    close_window: async (id) => void closed.push(id),
    focus_window: async () => {},
    activate_tab: async () => {},
    focus_page_content: async () => {},
  });
  await handlers.close_all();
  assert.deepEqual(closed, [1, 2, 3]);
});

test("browser.focus_page focuses window, tab, then page content", async () => {
  const log: string[] = [];
  const handlers = make_browser_handlers({
    window_ids: async () => [],
    close_window: async () => {},
    focus_window: async (id) => void log.push(`window ${id}`),
    activate_tab: async (id) => void log.push(`tab ${id}`),
    focus_page_content: async (id) => void log.push(`content ${id}`),
  });
  await handlers.focus_page(ctx);
  assert.deepEqual(log, ["window 2", "tab 7", "content 7"]);
});

const UNUSED_REMOVE = {
  nodes_for_url: async () => [],
  tab_url: async () => undefined,
  remove: async () => {},
  update: async () => {},
  move: async () => {},
  folders: async () => [],
  open_many: async () => {},
  toast: async () => {},
};

test("bookmark.add uses the tab title only when the tab shows that url", async () => {
  const created: unknown[] = [];
  const handlers = make_bookmark_handlers({
    tab_title_for_url: async (_id, url) => (url === "https://a.test/" ? "A" : undefined),
    create: async (bookmark) => void created.push(bookmark),
    bookmarks: async () => [],
    open: async () => {},
    ...UNUSED_REMOVE,
  });
  await handlers.add(ctx, { url: "https://a.test/", folder: "" });
  await handlers.add(ctx, { url: "https://b.test/", folder: "" });
  assert.deepEqual(created, [
    { url: "https://a.test/", title: "A" },
    { url: "https://b.test/", title: "https://b.test/" },
  ]);
});

const BOOKMARKS = [
  { title: "Rust book", url: "https://doc.rust-lang.org/book/" },
  { title: "Rust reference", url: "https://doc.rust-lang.org/reference/" },
  { title: "Arch wiki", url: "https://wiki.archlinux.org/" },
];

test("pick_bookmark takes an exact address first, then the best match", () => {
  assert.equal(pick_bookmark(BOOKMARKS, "https://doc.rust-lang.org/reference/").title, "Rust reference");
  assert.equal(pick_bookmark(BOOKMARKS, "arch").title, "Arch wiki");
  assert.equal(pick_bookmark(BOOKMARKS, "rust book").title, "Rust book");
});

test("pick_bookmark refuses an equal tie naming both, and says when nothing matches", () => {
  const twins = [{ title: "Docs", url: "https://a.test/" }, { title: "Docs", url: "https://b.test/" }];
  assert.throws(() => pick_bookmark(twins, "docs"), /"Docs" \(https:\/\/a.test\/\) and "Docs" \(https:\/\/b.test\/\) equally/);
  assert.throws(() => pick_bookmark(BOOKMARKS, "zzzz"), /no bookmark matches "zzzz"/);
});

test("bookmark.open opens the picked address where the flag says, and opens nothing on a refusal", async () => {
  const opened: string[] = [];
  const handlers = make_bookmark_handlers({
    tab_title_for_url: async () => undefined,
    create: async () => {},
    bookmarks: async () => BOOKMARKS,
    open: async (_ctx, url, where) => void opened.push(`${where} ${url}`),
    ...UNUSED_REMOVE,
  });
  await handlers.open(ctx, { bookmark: "arch", where: "tab" });
  await assert.rejects(handlers.open(ctx, { bookmark: "zzzz", where: "tab" }));
  assert.deepEqual(opened, ["tab https://wiki.archlinux.org/"]);
});

const FOLDERS: FolderNode[] = [
  { id: "f1", path: "Bookmarks Toolbar", managed: false, bookmarks: [] },
  { id: "f2", path: "Bookmarks Toolbar / Work", managed: false, bookmarks: [{ url: "https://w1.test/" }, { url: "place:sort=8" }, { url: "javascript:void(0)" }, { url: "https://w2.test/" }] },
  { id: "f3", path: "Other Bookmarks / Work", managed: false, bookmarks: [] },
  { id: "f4", path: "Managed", managed: true, bookmarks: [{ url: "https://m.test/" }, { url: "about:config" }, { url: "about:blank" }] },
];

type FakeNode = { id: string; url?: string; type?: string; unmodifiable?: string };

function remove_fixture(nodes: FakeNode[], tab_url: string | null = "https://a.test/") {
  const log: string[] = [];
  const asked: string[] = [];
  const handlers = make_bookmark_handlers({
    tab_title_for_url: async () => undefined,
    create: async () => {},
    open: async () => {},
    bookmarks: async () => BOOKMARKS,
    tab_url: async () => tab_url ?? undefined,
    nodes_for_url: async (url) => (asked.push(url), nodes.map((node) => ({ url, ...node }))),
    remove: async (id) => void log.push(`remove ${id}`),
    update: async (id, changes) => void log.push(`update ${id} ${JSON.stringify(changes)}`),
    move: async (id, parent_id) => void log.push(`move ${id} ${parent_id}`),
    folders: async () => FOLDERS,
    open_many: async (_ctx, urls, where, report) => {
      await report(0);
      log.push(`open ${where} ${urls.join(" ")}`);
    },
    toast: async (_ctx, kind, message) => void log.push(`${kind} ${message}`),
  });
  return { handlers, log, asked };
}

test("bookmark.remove with no argument removes every bookmark for the current page", async () => {
  const one = remove_fixture([{ id: "a", type: "bookmark" }]);
  await one.handlers.remove(ctx, { bookmark: "" });
  assert.deepEqual([one.asked, one.log], [["https://a.test/"], ["remove a", "success Removed 1 bookmark"]]);
  const two = remove_fixture([{ id: "a", type: "bookmark" }, { id: "b", type: "bookmark" }]);
  await two.handlers.remove(ctx, { bookmark: "" });
  assert.deepEqual(two.log, ["remove a", "remove b", "success Removed 2 bookmarks"]);
});

test("bookmark.remove refuses when the page has no bookmark, and when the tab has no address", async () => {
  const none = remove_fixture([]);
  await assert.rejects(none.handlers.remove(ctx, { bookmark: "" }), /No bookmark for this page/);
  const no_url = remove_fixture([{ id: "a", type: "bookmark" }], null);
  await assert.rejects(no_url.handlers.remove(ctx, { bookmark: "" }), /No bookmark for this page/);
  assert.deepEqual([none.log, no_url.log], [[], []]);
});

test("bookmark.remove with an argument removes the bookmarks at the picked address, and refuses no match", async () => {
  const picked = remove_fixture([{ id: "x", type: "bookmark" }, { id: "y", type: "bookmark" }]);
  await picked.handlers.remove(ctx, { bookmark: "arch" });
  assert.deepEqual([picked.asked, picked.log], [["https://wiki.archlinux.org/"], ["remove x", "remove y", "success Removed 2 bookmarks"]]);
  const missed = remove_fixture([{ id: "x", type: "bookmark" }]);
  await assert.rejects(missed.handlers.remove(ctx, { bookmark: "zzzz" }), /no bookmark matches/);
  assert.deepEqual(missed.log, []);
});

test("bookmark.remove never removes a folder", async () => {
  const mixed = remove_fixture([{ id: "dir", type: "folder" }, { id: "a", type: "bookmark" }]);
  await mixed.handlers.remove(ctx, { bookmark: "" });
  assert.deepEqual(mixed.log, ["remove a", "success Removed 1 bookmark"]);
  const only_folder = remove_fixture([{ id: "dir", type: "folder" }]);
  await assert.rejects(only_folder.handlers.remove(ctx, { bookmark: "" }), /No bookmark/);
  assert.deepEqual(only_folder.log, []);
});

test("bookmark.remove keeps only the exact address, and skips managed and typeless-folder nodes", async () => {
  const fixture = remove_fixture([
    { id: "near", url: "https://A.test" },
    { id: "plain" },
    { id: "managed", unmodifiable: "managed" },
    { id: "sep", type: "separator" },
  ]);
  await fixture.handlers.remove(ctx, { bookmark: "" });
  assert.deepEqual(fixture.log, ["remove plain", "success Removed 1 bookmark"]);
});

test("bookmark.remove refuses before removing anything when every match is managed", async () => {
  const fixture = remove_fixture([{ id: "managed", unmodifiable: "managed" }]);
  await assert.rejects(fixture.handlers.remove(ctx, { bookmark: "" }), /managed and cannot be removed/);
  assert.deepEqual(fixture.log, []);
});

// Windows in getAll order: 1 normal (the current one), 2 private, 3 normal used long ago, 4 normal used just now.
const attach_windows = (): WindowLike[] => [
  { id: 2, type: "normal", incognito: false, tabs: [{ active: true, title: "Here", lastAccessed: 500 }] },
  { id: 5, type: "normal", incognito: true, tabs: [{ active: true, title: "Secret", lastAccessed: 900 }] },
  { id: 6, type: "normal", incognito: false, tabs: [{ active: true, title: "Old", lastAccessed: 100 }] },
  { id: 7, type: "normal", incognito: false, tabs: [{ active: true, title: "Recent", lastAccessed: 800 }] },
];

function attach_fake(windows: WindowLike[] = attach_windows(), recent_ids: number[] = []) {
  const log: string[] = [];
  const handlers = make_window_handlers({
    create: async () => {},
    close: async () => {},
    restore_last_closed_window: async () => false,
    windows: async () => windows,
    recent_window_ids: async () => recent_ids,
    // A move never unpins: the only calls are the move and the focus.
    move_tab_to_window: async (tab_id, window_id) => void log.push(`move ${tab_id} to ${window_id}`),
  });
  return { handlers, log };
}

test("tab.attach moves the tab to the numbered window", async () => {
  const { handlers, log } = attach_fake();
  await handlers.attach(ctx, { window: "3 Old" });
  assert.deepEqual(log, ["move 7 to 6"]);
});

test("tab.attach reads the number and ignores a stale title", async () => {
  const { handlers, log } = attach_fake();
  await handlers.attach(ctx, { window: "4 Renamed since" });
  assert.deepEqual(log, ["move 7 to 7"]);
});

test("a bare tab.attach goes to the other window of the same privacy that was used last", async () => {
  const { handlers, log } = attach_fake();
  await handlers.attach(ctx, { window: "" });
  assert.deepEqual(log, ["move 7 to 7"]);
});

test("tab.attach refuses a private window from a normal one, and the reverse", async () => {
  const { handlers, log } = attach_fake();
  await assert.rejects(handlers.attach(ctx, { window: "2" }), /Cannot move a tab between private and normal windows/);
  await assert.rejects(handlers.attach({ ...ctx, window_id: 5 }, { window: "1" }), /Cannot move a tab between private and normal windows/);
  assert.deepEqual(log, []);
});

test("tab.attach refuses with one window, its own window and an unknown number", async () => {
  const only = attach_fake([{ id: 2, type: "normal", incognito: false, tabs: [] }]);
  await assert.rejects(only.handlers.attach(ctx, { window: "" }), /No other window to move to/);
  const no_match = attach_fake([{ id: 2, type: "normal", incognito: false, tabs: [] }, { id: 5, type: "normal", incognito: true, tabs: [] }]);
  await assert.rejects(no_match.handlers.attach(ctx, { window: "" }), /No other window to move to/);
  const { handlers, log } = attach_fake();
  await assert.rejects(handlers.attach(ctx, { window: "1" }), /already in that window/);
  await assert.rejects(handlers.attach(ctx, { window: "9" }), /No window 9/);
  assert.deepEqual(log, []);
});

test("a bare tab.attach never picks a popup window, even the one used last", async () => {
  const windows = [...attach_windows(), { id: 8, type: "popup", incognito: false, tabs: [{ active: true, title: "Pop", lastAccessed: 999 }] }];
  const { handlers, log } = attach_fake(windows, [8]);
  await handlers.attach(ctx, { window: "" });
  assert.deepEqual(log, ["move 7 to 7"]);
  await assert.rejects(handlers.attach(ctx, { window: "5" }), /No window 5/);
});

test("a bare tab.attach goes to the window focused last, ahead of the one touched last", async () => {
  const { handlers, log } = attach_fake(attach_windows(), [2, 6, 7]);
  await handlers.attach(ctx, { window: "" });
  assert.deepEqual(log, ["move 7 to 6"]);
});

test("a bare tab.attach skips a focused window that is closed, private or the current one", async () => {
  const { handlers, log } = attach_fake(attach_windows(), [99, 5, 2, 6]);
  await handlers.attach(ctx, { window: "" });
  assert.deepEqual(log, ["move 7 to 6"]);
});

test("a bare tab.attach falls back to the last touched window when no focused window is a candidate", async () => {
  const { handlers, log } = attach_fake(attach_windows(), [99, 5, 2]);
  await handlers.attach(ctx, { window: "" });
  assert.deepEqual(log, ["move 7 to 7"]);
});

test("the schema refuses a tab.attach pick with no leading number, and lets an empty pick through", () => {
  const attach = registry.get("tab.attach")!;
  assert.equal(check_args(attach, { window: "Old" }, {}).ok, false);
  for (const window of ["", "  ", "2", "2 GitHub", " 2 GitHub"]) assert.equal(check_args(attach, { window }, {}).ok, true, window);
  assert.deepEqual(check_args(attach, undefined, {}), { ok: true, args: { window: "" } });
});

test("bookmark.add refuses an address that already has a bookmark, and creates nothing", async () => {
  const created: unknown[] = [];
  const handlers = make_bookmark_handlers({
    ...UNUSED_REMOVE,
    tab_title_for_url: async () => "A",
    create: async (bookmark) => void created.push(bookmark),
    bookmarks: async () => [],
    open: async () => {},
    nodes_for_url: async (url) => [{ id: "a", url, type: "bookmark" }],
  });
  await assert.rejects(handlers.add(ctx, { url: "https://a.test/", folder: "" }), /Already bookmarked/);
  assert.deepEqual(created, []);
});

test("bookmark.rename renames every bookmark with the page's address and toasts the count", async () => {
  const fixture = remove_fixture([{ id: "a", type: "bookmark" }, { id: "b", type: "bookmark" }, { id: "m", type: "bookmark", unmodifiable: "managed" }]);
  await fixture.handlers.rename(ctx, { bookmark: "", title: "New name" });
  assert.deepEqual(fixture.log, ['update a {"title":"New name"}', 'update b {"title":"New name"}', "success Renamed 2 bookmarks"]);
});

test("bookmark.rename with a picked bookmark renames the ones at its address, and refuses managed-only and none", async () => {
  const picked = remove_fixture([{ id: "x", type: "bookmark" }]);
  await picked.handlers.rename(ctx, { bookmark: "arch", title: "Wiki" });
  assert.deepEqual([picked.asked, picked.log], [["https://wiki.archlinux.org/"], ['update x {"title":"Wiki"}', "success Renamed 1 bookmark"]]);
  const managed = remove_fixture([{ id: "m", type: "bookmark", unmodifiable: "managed" }]);
  await assert.rejects(managed.handlers.rename(ctx, { bookmark: "", title: "x" }), /managed and cannot be renamed/);
  await assert.rejects(remove_fixture([]).handlers.rename(ctx, { bookmark: "", title: "x" }), /No bookmark for this page/);
  assert.deepEqual(managed.log, []);
});

test("bookmark.edit_url changes the address of every bookmark at the page's address", async () => {
  const fixture = remove_fixture([{ id: "a", type: "bookmark" }, { id: "b", type: "bookmark" }]);
  await fixture.handlers.edit_url(ctx, { bookmark: "", url: "https://c.test/" });
  assert.deepEqual(fixture.log, ['update a {"url":"https://c.test/"}', 'update b {"url":"https://c.test/"}', "success Changed the address of 2 bookmarks"]);
});

test("bookmark.edit_url refuses an address another bookmark has, and managed bookmarks", async () => {
  const log: string[] = [];
  const handlers = make_bookmark_handlers({
    ...UNUSED_REMOVE,
    tab_title_for_url: async () => undefined,
    create: async () => {},
    bookmarks: async () => [],
    open: async () => {},
    tab_url: async () => "https://a.test/",
    nodes_for_url: async (url) => [{ id: url === "https://a.test/" ? "a" : "other", url, type: "bookmark" }],
    update: async (id) => void log.push(id),
  });
  await assert.rejects(handlers.edit_url(ctx, { bookmark: "", url: "https://b.test/" }), /Already bookmarked/);
  assert.deepEqual(log, []);
  const managed = remove_fixture([{ id: "m", type: "bookmark", unmodifiable: "managed" }]);
  await assert.rejects(managed.handlers.edit_url(ctx, { bookmark: "", url: "https://c.test/" }), /managed and cannot be changed/);
});

test("bookmark.add with a folder files the bookmark there, and an exact path wins over a fuzzy one", async () => {
  const created: unknown[] = [];
  const handlers = make_bookmark_handlers({
    ...UNUSED_REMOVE,
    folders: async () => FOLDERS,
    tab_title_for_url: async () => "A",
    create: async (bookmark) => void created.push(bookmark),
    bookmarks: async () => [],
    open: async () => {},
  });
  await handlers.add(ctx, { url: "https://a.test/", folder: "Bookmarks Toolbar" });
  await handlers.add(ctx, { url: "https://a.test/", folder: "Other Bookmarks / Work" });
  await handlers.add(ctx, { url: "https://a.test/", folder: "" });
  assert.deepEqual(created, [
    { url: "https://a.test/", title: "A", parent_id: "f1" },
    { url: "https://a.test/", title: "A", parent_id: "f3" },
    { url: "https://a.test/", title: "A" },
  ]);
});

test("bookmark.add with a folder on a bookmarked page points to bm, and an unknown folder creates nothing", async () => {
  const created: unknown[] = [];
  const base = { ...UNUSED_REMOVE, folders: async () => FOLDERS, tab_title_for_url: async () => "A", create: async (bookmark: unknown) => void created.push(bookmark), bookmarks: async () => [], open: async () => {} };
  const bookmarked = make_bookmark_handlers({ ...base, nodes_for_url: async (url) => [{ id: "a", url, type: "bookmark" }] });
  await assert.rejects(bookmarked.add(ctx, { url: "https://a.test/", folder: "Bookmarks Toolbar" }), /Already bookmarked, use bm to move/);
  const fresh = make_bookmark_handlers(base);
  await assert.rejects(fresh.add(ctx, { url: "https://a.test/", folder: "zzzz" }), /no folder matches "zzzz"/);
  assert.deepEqual(created, []);
});

test("a folder path that two folders share, and a fuzzy tie, are refused naming the folders", async () => {
  const twins: FolderNode[] = [{ id: "x", path: "Docs", managed: false, bookmarks: [] }, { id: "y", path: "Docs", managed: false, bookmarks: [] }];
  assert.throws(() => pick_folder(twins, "Docs"), /Two folders match "Docs"/);
  assert.throws(() => pick_folder(FOLDERS, "work"), /"work" matches "Bookmarks Toolbar \/ Work" and "Other Bookmarks \/ Work" equally/);
  assert.equal(pick_folder(FOLDERS, "toolbar work").id, "f2");
});

test("bookmark.move moves every unmanaged bookmark at the address and toasts the count", async () => {
  const fixture = remove_fixture([{ id: "a", type: "bookmark" }, { id: "b", type: "bookmark" }, { id: "m", type: "bookmark", unmodifiable: "managed" }]);
  await fixture.handlers.move(ctx, { folder: "Other Bookmarks / Work", bookmark: "" });
  assert.deepEqual(fixture.log, ["move a f3", "move b f3", "success Moved 2 bookmarks to Other Bookmarks / Work"]);
});

test("bookmark.move with a picked bookmark moves the ones at its address, and refuses managed-only, none and an unknown folder", async () => {
  const picked = remove_fixture([{ id: "x", type: "bookmark" }]);
  await picked.handlers.move(ctx, { folder: "Bookmarks Toolbar", bookmark: "arch" });
  assert.deepEqual([picked.asked, picked.log], [["https://wiki.archlinux.org/"], ["move x f1", "success Moved 1 bookmark to Bookmarks Toolbar"]]);
  const managed = remove_fixture([{ id: "m", type: "bookmark", unmodifiable: "managed" }]);
  await assert.rejects(managed.handlers.move(ctx, { folder: "Bookmarks Toolbar", bookmark: "" }), /managed and cannot be moved/);
  await assert.rejects(remove_fixture([]).handlers.move(ctx, { folder: "Bookmarks Toolbar", bookmark: "" }), /No bookmark for this page/);
  const unknown = remove_fixture([{ id: "x", type: "bookmark" }]);
  await assert.rejects(unknown.handlers.move(ctx, { folder: "zzzz", bookmark: "" }), /no folder matches/);
  assert.deepEqual(unknown.log, []);
});

test("bookmark.open_folder opens the folder's own bookmarks, skipping smart queries and script addresses", async () => {
  const fixture = remove_fixture([]);
  await fixture.handlers.open_folder(ctx, { folder: "Bookmarks Toolbar / Work", where: "window" });
  assert.deepEqual(fixture.log, ["warning Opened 2 of 4 bookmarks: 2 cannot be opened", "open window https://w1.test/ https://w2.test/"]);
});

test("bookmark.open_folder refuses an empty folder and an unknown one", async () => {
  const fixture = remove_fixture([]);
  await assert.rejects(fixture.handlers.open_folder(ctx, { folder: "Bookmarks Toolbar", where: "tab" }), /No bookmarks to open in Bookmarks Toolbar/);
  await assert.rejects(fixture.handlers.open_folder(ctx, { folder: "zzzz", where: "tab" }), /no folder matches/);
  assert.deepEqual(fixture.log, []);
});

test("bookmark.open_folder opens the first 25 and the toast says the cap cut the list", async () => {
  const many: FolderNode = { id: "big", path: "Big", managed: false, bookmarks: Array.from({ length: 30 }, (_, index) => ({ url: `https://p${index}.test/` })) };
  const log: string[] = [];
  const handlers = make_bookmark_handlers({
    ...UNUSED_REMOVE,
    folders: async () => [many],
    tab_title_for_url: async () => undefined,
    create: async () => {},
    bookmarks: async () => [],
    open: async () => {},
    open_many: async (_ctx, urls, where, report) => {
      await report(0);
      log.push(`open ${where} ${urls.length} ${urls[24]} ${urls[25]}`);
    },
    toast: async (_ctx, kind, message) => void log.push(`${kind} ${message}`),
  });
  await handlers.open_folder(ctx, { folder: "Big", where: "tab" });
  // The toast comes before the open, since the open moves the focus off the asking tab.
  assert.deepEqual(log, ["warning Opened 25 of 30 bookmarks: the cap is 25", "open tab 25 https://p24.test/ undefined"]);
});

test("bookmark.open_folder skips browser pages that would stop the rest, and the toast counts them", async () => {
  const fixture = remove_fixture([]);
  await fixture.handlers.open_folder(ctx, { folder: "Managed", where: "tab" });
  assert.deepEqual(fixture.log, ["warning Opened 2 of 3 bookmarks: 1 cannot be opened", "open tab https://m.test/ about:blank"]);
});

test("a managed folder is refused as a target for add and move, and still opens", async () => {
  const fixture = remove_fixture([{ id: "x", type: "bookmark" }]);
  await assert.rejects(fixture.handlers.move(ctx, { folder: "Managed", bookmark: "" }), /Managed is managed and cannot be changed/);
  await assert.rejects(remove_fixture([]).handlers.add(ctx, { url: "https://n.test/", folder: "Managed" }), /Managed is managed and cannot be changed/);
});

const ASKER: CommandContext = { tab_id: 5, window_id: 2, frame_id: 0, mode: "normal" };

// A fake browser that numbers the tabs it makes and refuses the addresses in `refused`.
function fake_browser(refused: string[], calls: string[]) {
  let next_id = 10;
  const refuse = (url: string) => {
    if (refused.includes(url)) throw new Error("Illegal URL");
  };
  (globalThis as unknown as { browser: unknown }).browser = {
    tabs: {
      create: async (props: { url: string; active: boolean; openerTabId?: number; windowId?: number }) => {
        refuse(props.url);
        calls.push(`tab ${props.url} active=${props.active} opener=${props.openerTabId ?? "-"} window=${props.windowId}`);
        return { id: next_id++ };
      },
      update: async (id: number, props: object) => void calls.push(`update ${id} ${JSON.stringify(props)}`),
    },
    windows: {
      create: async (props: { url: string }) => {
        refuse(props.url);
        calls.push(`window ${props.url}`);
        return { id: 99 };
      },
    },
  };
}

test("open_many opens every tab in the background in order, then activates the first, so the strip keeps folder order", async () => {
  const calls: string[] = [];
  fake_browser([], calls);
  try {
    await open_many(ASKER, ["https://a.test/", "https://b.test/", "https://c.test/"], "tab", async (failed) => void calls.push(`report ${failed}`));
  } finally {
    delete (globalThis as unknown as { browser?: unknown }).browser;
  }
  assert.deepEqual(calls, ["tab https://a.test/ active=false opener=5 window=2", "tab https://b.test/ active=false opener=5 window=2", "tab https://c.test/ active=false opener=5 window=2", "report 0", 'update 10 {"active":true}']);
});

test("open_many in the background never activates a tab, and a window holds the tabs that open", async () => {
  const calls: string[] = [];
  fake_browser([], calls);
  try {
    await open_many(ASKER, ["https://a.test/", "https://b.test/"], "background", async () => {});
    await open_many(ASKER, ["https://a.test/", "https://b.test/"], "window", async () => {});
  } finally {
    delete (globalThis as unknown as { browser?: unknown }).browser;
  }
  assert.deepEqual(calls, ["tab https://a.test/ active=false opener=5 window=2", "tab https://b.test/ active=false opener=5 window=2", "window https://a.test/", "tab https://b.test/ active=false opener=- window=99"]);
});

test("open_many skips an address the browser refuses, counts it, and still opens the window and the later tabs", async () => {
  const tabs: string[] = [];
  fake_browser(["file:///x.html"], tabs);
  const reports: number[] = [];
  try {
    await open_many(ASKER, ["file:///x.html", "https://b.test/", "https://c.test/"], "tab", async (failed) => void reports.push(failed));
    await open_many(ASKER, ["file:///x.html", "https://b.test/", "file:///x.html", "https://c.test/"], "window", async (failed) => void reports.push(failed));
  } finally {
    delete (globalThis as unknown as { browser?: unknown }).browser;
  }
  assert.deepEqual(reports, [1, 2]);
  assert.deepEqual(tabs.filter((call) => call.startsWith("window")), ["window https://b.test/"]);
  assert.ok(tabs.includes('update 10 {"active":true}'));
});

test("bookmark.open_folder refuses when the browser refuses every address", async () => {
  const handlers = make_bookmark_handlers({
    ...UNUSED_REMOVE,
    folders: async () => [{ id: "z", path: "Z", managed: false, bookmarks: [{ url: "https://z.test/" }] }],
    tab_title_for_url: async () => undefined,
    create: async () => {},
    bookmarks: async () => [],
    open: async () => {},
    open_many: async (_ctx, urls, _where, report) => report(urls.length),
  });
  await assert.rejects(handlers.open_folder(ctx, { folder: "Z", where: "tab" }), /None of the bookmarks in Z could be opened/);
});
