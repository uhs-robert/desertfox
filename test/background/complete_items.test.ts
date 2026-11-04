import assert from "node:assert/strict";
import { test } from "node:test";
import { bookmark_items, create_complete_items, engine_items, flatten_bookmarks, listed_tabs, listed_windows } from "../../src/background/complete_items.ts";
import type { BookmarkNode, LineScope, TabLike, WindowLike } from "../../src/background/complete_items.ts";

const tab = (id: number, index: number, window_id: number, incognito: boolean, title = `Tab ${id}`): TabLike => ({ id, index, windowId: window_id, title, url: `https://site${id}.test/`, incognito });
const NORMAL_LINE: LineScope & { tab_id: number } = { tab_id: 1, window_id: 10, incognito: false };
const PRIVATE_LINE = { tab_id: 2, window_id: 20, incognito: true };

// Tabs of two normal windows and one private window.
const ALL_TABS = [tab(1, 0, 10, false), tab(2, 1, 10, false), tab(3, 0, 11, false), tab(4, 0, 20, true), tab(5, 1, 20, true)];

const ENGINES = {
  duck: { url: "https://duckduckgo.com/?q={query}", label: "DuckDuckGo" },
  "github.repo": { url: "https://github.com/{repo}", label: "GitHub: this repo", slots: ["repo"] },
  "github.repo.issues": { url: "https://github.com/{repo}/issues?q={query}", label: "GitHub: this repo: issues", slots: ["repo"] },
  "github.repo.fb": { url: "https://github.com/{repo}", label: "GitHub fallback", slots: ["repo"], fallback: "https://github.com/" },
};

const window_of = (id: number, incognito: boolean, title: string): WindowLike => ({
  id,
  incognito,
  tabs: [{ active: false, title: "background tab" }, { active: true, title, url: `https://w${id}.test/`, lastAccessed: id }],
});
// Two normal windows and one private window, in `windows.getAll` order.
const WINDOWS = [window_of(10, false, "Mail"), window_of(20, true, "Secret"), window_of(11, false, "Docs\n tab")];

function make({ openers = [1, 2], all_windows = false, tabs = ALL_TABS, bookmarks = [] as BookmarkNode[], fail = false, page = undefined as { url: string } | undefined } = {}) {
  const asked: (number | undefined)[] = [];
  const opened = new Set(openers);
  const service = create_complete_items({
    query_tabs: async (window_id) => {
      asked.push(window_id);
      if (fail) throw new Error("no tabs");
      return tabs.filter((candidate) => window_id === undefined || candidate.windowId === window_id);
    },
    query_windows: async () => {
      if (fail) throw new Error("no windows");
      return WINDOWS;
    },
    all_bookmarks: async () => {
      if (fail) throw new Error("no bookmarks");
      return bookmarks;
    },
    is_opener: async (tab_id) => opened.has(tab_id),
    all_windows: async () => all_windows,
    search_engines: async () => ENGINES,
    page_of: async () => page,
  });
  return { service, asked, opened };
}

const titles = (answer: Awaited<ReturnType<ReturnType<typeof make>["service"]["answer"]>>) => (answer?.items as { title: string }[]).map((item) => item.title);

test("a tab that redeemed no ticket gets nothing and the browser is not asked", async () => {
  const { service, asked } = make({ openers: [] });
  assert.equal(await service.answer("tabs", NORMAL_LINE), undefined);
  assert.equal(await service.answer("bookmarks", NORMAL_LINE), undefined);
  assert.deepEqual(asked, []);
});

test("a sender that is not a tab, and an unknown kind, get nothing", async () => {
  const { service } = make();
  assert.equal(await service.answer("tabs", undefined), undefined);
  assert.equal(await service.answer("history", NORMAL_LINE), undefined);
});

test("a normal line lists only normal tabs and a private line only private tabs", async () => {
  const { service } = make({ all_windows: true });
  assert.deepEqual(titles(await service.answer("tabs", NORMAL_LINE)), ["Tab 1", "Tab 2", "Tab 3"]);
  assert.deepEqual(titles(await service.answer("tabs", PRIVATE_LINE)), ["Tab 4", "Tab 5"]);
});

test("a private tab in the line's own window stays out of a normal line", () => {
  const mixed = [tab(1, 0, 10, false), tab(2, 1, 10, true)];
  assert.deepEqual(listed_tabs(mixed, { window_id: 10, incognito: false }).map((item) => item.id), [1]);
  assert.deepEqual(listed_tabs(mixed, { window_id: 10, incognito: true }).map((item) => item.id), [2]);
});

test("the current window by default, every window with the setting, and the line's window first", async () => {
  const one = make();
  assert.deepEqual(titles(await one.service.answer("tabs", NORMAL_LINE)), ["Tab 1", "Tab 2"]);
  assert.deepEqual(one.asked, [10]);
  const all = make({ all_windows: true });
  const answer = await all.service.answer("tabs", { ...NORMAL_LINE, window_id: 11 });
  assert.deepEqual(titles(answer), ["Tab 3", "Tab 1", "Tab 2"]);
  assert.deepEqual(all.asked, [undefined]);
});

test("the number is the place in the tab bar counted from 1, current tab included", async () => {
  const { service } = make();
  const answer = await service.answer("tabs", NORMAL_LINE);
  assert.deepEqual(answer?.items, [
    { number: 1, title: "Tab 1", url: "https://site1.test/" },
    { number: 2, title: "Tab 2", url: "https://site2.test/" },
  ]);
});

test("a tab with no title shows its address, and a title is cut to one line", () => {
  const listed = listed_tabs([{ id: 1, index: 0, windowId: 1, title: "", url: "https://a.test/", incognito: false }, tab(2, 1, 1, false, "two\n  lines")], { window_id: 1, incognito: false });
  assert.deepEqual(listed.map((item) => item.title), ["https://a.test/", "two lines"]);
});

test("bookmarks drop folders and separators, merge equal addresses and keep the newest first", async () => {
  const bookmarks: BookmarkNode[] = [
    { type: "bookmark", title: "New", url: "https://a.test/" },
    { type: "folder", title: "Folder" },
    { type: "separator" },
    { type: "bookmark", title: "Old copy", url: "https://a.test/" },
    { title: "", url: "https://b.test/" },
  ];
  assert.deepEqual(bookmark_items(bookmarks), [
    { title: "New", url: "https://a.test/" },
    { title: "https://b.test/", url: "https://b.test/" },
  ]);
  const { service } = make({ bookmarks });
  assert.deepEqual((await service.answer("bookmarks", PRIVATE_LINE))?.items.length, 2);
});

test("a failed browser call gives an empty list, not an error", async () => {
  const { service } = make({ fail: true });
  assert.deepEqual(await service.answer("tabs", NORMAL_LINE), { items: [] });
  assert.deepEqual(await service.answer("bookmarks", NORMAL_LINE), { items: [] });
});

test("a tab that navigates or closes while the lookup runs gets nothing", async () => {
  const opened = new Set([1]);
  const service = create_complete_items({
    query_tabs: async () => {
      opened.delete(1);
      return ALL_TABS;
    },
    query_windows: async () => WINDOWS,
    all_bookmarks: async () => {
      opened.delete(1);
      return [];
    },
    is_opener: async (tab_id) => opened.has(tab_id),
    all_windows: async () => false,
    search_engines: async () => ENGINES,
    page_of: async () => undefined,
  });
  assert.equal(await service.answer("tabs", NORMAL_LINE), undefined);
  opened.add(1);
  assert.equal(await service.answer("bookmarks", NORMAL_LINE), undefined);
});

test("the bookmark tree flattens to every nested bookmark, newest added first, with no cap", () => {
  const tree: BookmarkNode[] = [
    { type: "folder", dateAdded: 1, children: [{ type: "bookmark", title: "Old", url: "https://old.test/", dateAdded: 10 }, { type: "folder", dateAdded: 2, children: [{ type: "bookmark", title: "Deep", url: "https://deep.test/", dateAdded: 30 }] }] },
    { type: "bookmark", title: "Mid", url: "https://mid.test/", dateAdded: 20 },
  ];
  assert.deepEqual(bookmark_items(flatten_bookmarks(tree)).map((item) => item.title), ["Deep", "Mid", "Old"]);
  const many: BookmarkNode[] = Array.from({ length: 12_000 }, (_, index) => ({ type: "bookmark", title: `B${index}`, url: `https://b${index}.test/`, dateAdded: index }));
  assert.equal(bookmark_items(flatten_bookmarks([{ type: "folder", children: many }])).length, 12_000);
});

test("engines come back in config order with a yes or no, and a tab with no marker gets nothing", async () => {
  const page = { url: "https://github.com/acme/widgets" };
  const { service } = make({ page });
  assert.deepEqual((await service.answer("engines", NORMAL_LINE))?.items, [
    { name: "duck", label: "DuckDuckGo", available: true },
    { name: "github.repo", label: "GitHub: this repo", available: true },
    { name: "github.repo.issues", label: "GitHub: this repo: issues", available: true },
    { name: "github.repo.fb", label: "GitHub fallback", available: true },
  ]);
  assert.equal(await make({ openers: [] }).service.answer("engines", NORMAL_LINE), undefined);
});

test("a page that cannot fill a slot marks the engine, a fallback engine stays available, and no URL leaves", async () => {
  const { service } = make({ page: { url: "https://example.com/" } });
  const items = (await service.answer("engines", NORMAL_LINE))!.items as { name: string; available: boolean }[];
  assert.deepEqual(items.map((item) => [item.name, item.available]), [["duck", true], ["github.repo", false], ["github.repo.issues", false], ["github.repo.fb", true]]);
  assert.ok(!JSON.stringify(items).includes("example.com"));
});

test("a line with no page offers only the engines that need no slot or have a fallback", () => {
  assert.deepEqual(engine_items(ENGINES, undefined).filter((item) => item.available).map((item) => item.name), ["duck", "github.repo.fb"]);
});

test("a normal line lists the other normal windows by their getAll place and active tab title", async () => {
  assert.deepEqual(listed_windows(WINDOWS, NORMAL_LINE).map(({ number, title }) => ({ number, title })), [{ number: 3, title: "Docs tab" }]);
  assert.deepEqual(listed_windows(WINDOWS, { window_id: 11, incognito: false }).map((window) => window.number), [1]);
});

test("a private line lists only private windows, and its own window drops out", async () => {
  assert.deepEqual(listed_windows(WINDOWS, { window_id: 99, incognito: true }).map((window) => window.title), ["Secret"]);
  assert.deepEqual(listed_windows(WINDOWS, { window_id: 20, incognito: true }), []);
});

test("the windows answer holds the number and title only, and a failed call gives an empty list", async () => {
  const { service } = make();
  assert.deepEqual(await service.answer("windows", NORMAL_LINE), { items: [{ number: 3, title: "Docs tab" }] });
  assert.equal(await make({ openers: [] }).service.answer("windows", NORMAL_LINE), undefined);
  assert.deepEqual(await make({ fail: true }).service.answer("windows", NORMAL_LINE), { items: [] });
});
