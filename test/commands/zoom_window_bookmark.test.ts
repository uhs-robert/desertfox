import assert from "node:assert/strict";
import { test } from "node:test";
import { make_bookmark_handlers, pick_bookmark } from "../../src/commands/bookmark.ts";
import { make_browser_handlers } from "../../src/commands/browser.ts";
import { clamp_zoom, make_zoom_handlers } from "../../src/commands/zoom.ts";
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

test("bookmark.add uses the tab title only when the tab shows that url", async () => {
  const created: unknown[] = [];
  const handlers = make_bookmark_handlers({
    tab_title_for_url: async (_id, url) => (url === "https://a.test/" ? "A" : undefined),
    create: async (bookmark) => void created.push(bookmark),
    bookmarks: async () => [],
    open: async () => {},
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
  });
  await handlers.open(ctx, { bookmark: "arch", where: "tab" });
  await assert.rejects(handlers.open(ctx, { bookmark: "zzzz", where: "tab" }));
  assert.deepEqual(opened, ["tab https://wiki.archlinux.org/"]);
});

// Windows in getAll order: 1 normal (the current one), 2 private, 3 normal used long ago, 4 normal used just now.
const attach_windows = (): WindowLike[] => [
  { id: 2, incognito: false, tabs: [{ active: true, title: "Here", lastAccessed: 500 }] },
  { id: 5, incognito: true, tabs: [{ active: true, title: "Secret", lastAccessed: 900 }] },
  { id: 6, incognito: false, tabs: [{ active: true, title: "Old", lastAccessed: 100 }] },
  { id: 7, incognito: false, tabs: [{ active: true, title: "Recent", lastAccessed: 800 }] },
];

function attach_fake(windows: WindowLike[] = attach_windows()) {
  const log: string[] = [];
  const handlers = make_window_handlers({
    create: async () => {},
    close: async () => {},
    restore_last_closed_window: async () => false,
    windows: async () => windows,
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

test("tab.attach refuses with one window, its own window, an unknown number and text with no number", async () => {
  const only = attach_fake([{ id: 2, incognito: false, tabs: [] }]);
  await assert.rejects(only.handlers.attach(ctx, { window: "" }), /No other window to move to/);
  const no_match = attach_fake([{ id: 2, incognito: false, tabs: [] }, { id: 5, incognito: true, tabs: [] }]);
  await assert.rejects(no_match.handlers.attach(ctx, { window: "" }), /No other window to move to/);
  const { handlers, log } = attach_fake();
  await assert.rejects(handlers.attach(ctx, { window: "1" }), /already in that window/);
  await assert.rejects(handlers.attach(ctx, { window: "9" }), /No window 9/);
  await assert.rejects(handlers.attach(ctx, { window: "Old" }), /Give a window number/);
  assert.deepEqual(log, []);
});
