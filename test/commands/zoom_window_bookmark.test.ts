import assert from "node:assert/strict";
import { test } from "node:test";
import { make_bookmark_handlers, pick_bookmark } from "../../src/commands/bookmark.ts";
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
  await handlers.add(ctx, { url: "https://a.test/" });
  await handlers.add(ctx, { url: "https://b.test/" });
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
