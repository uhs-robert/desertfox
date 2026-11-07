import assert from "node:assert/strict";
import { test } from "node:test";
import { bookmark_items, create_complete_items, engine_items, flatten_bookmarks, history_items, listed_favicon, listed_tabs, listed_windows, read_container_identities, read_containers } from "../../src/background/complete_items.ts";
import type { TabActionDeps } from "../../src/background/tab_actions.ts";
import type { DiscardDeps } from "../../src/background/tab_discard.ts";
import type { BookmarkNode, ContainerMarks, HistoryNode, LineScope, OpenSettings, TabLike, WindowLike } from "../../src/background/complete_items.ts";

type TabActions = Pick<TabActionDeps, "set_muted" | "set_pinned" | "remove" | "open_tab">;
const NO_ACTIONS: TabActions = { set_muted: async () => {}, set_pinned: async () => {}, remove: async () => {}, open_tab: async () => {} };

const tab = (id: number, index: number, window_id: number, incognito: boolean, title = `Tab ${id}`): TabLike => ({ id, index, windowId: window_id, title, url: `https://site${id}.test/`, incognito });
const NORMAL_LINE: LineScope & { tab_id: number; frame_id: number } = { tab_id: 1, frame_id: 3, window_id: 10, incognito: false };
const PRIVATE_LINE = { tab_id: 2, frame_id: 3, window_id: 20, incognito: true };

// Tabs of two normal windows and one private window.
const ALL_TABS = [tab(1, 0, 10, false), tab(2, 1, 10, false), tab(3, 0, 11, false), tab(4, 0, 20, true), tab(5, 1, 20, true)];

const ENGINES = {
  duck: { url: "https://duckduckgo.com/?q={query}", label: "DuckDuckGo" },
  "github.repo": { url: "https://github.com/{repo}", label: "GitHub: this repo", slots: ["repo"] },
  "github.repo.issues": { url: "https://github.com/{repo}/issues?q={query}", label: "GitHub: this repo: issues", slots: ["repo"] },
  "github.repo.fb": { url: "https://github.com/{repo}", label: "GitHub fallback", slots: ["repo"], fallback: "https://github.com/" },
};

const window_of = (id: number, incognito: boolean, title: string, type = "normal"): WindowLike => ({
  id,
  type,
  incognito,
  tabs: [{ active: false, title: "background tab" }, { active: true, title, url: `https://w${id}.test/`, lastAccessed: id }],
});
// Two normal windows and one private window, in `windows.getAll` order.
const WINDOWS = [window_of(10, false, "Mail"), window_of(20, true, "Secret"), window_of(11, false, "Docs\n tab")];

function make({ openers = [1, 2], tabs = ALL_TABS, bookmarks = [] as BookmarkNode[], fail = false, page = undefined as { url: string } | undefined, history = [] as HistoryNode[], open = { sources: ["bookmarks", "history"], history_max: 10 } as OpenSettings, read_tab = (async () => undefined) as (id: number) => Promise<TabLike | undefined>, discard = {} as DiscardDeps, tab_actions = NO_ACTIONS as TabActions, containers = new Map() as ContainerMarks, on_containers = () => {}, list_max = 20 } = {}) {
  const history_reads: number[] = [];
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
    containers: async () => {
      on_containers();
      return containers;
    },
    previous_tab: async () => undefined,
    read_tab,
    discard,
    tab_actions,
    search_engines: async () => ENGINES,
    page_of: async () => page,
    search_history: async () => {
      history_reads.push(1);
      if (fail) throw new Error("no history");
      return history;
    },
    open_settings: async () => open,
    history_list_max: async () => list_max,
  });
  return { service, asked, opened, history_reads };
}

const titles = (answer: Awaited<ReturnType<ReturnType<typeof make>["service"]["answer"]>>) => (answer?.items as { title: string }[]).map((item) => item.title);

test("a tab that redeemed no ticket gets nothing and the browser is not asked", async () => {
  const { service, history_reads } = make({ openers: [] });
  assert.equal(await service.answer("bookmarks", NORMAL_LINE), undefined);
  assert.equal(await service.answer("open", NORMAL_LINE), undefined);
  assert.deepEqual(history_reads, []);
});

test("a sender that is not a tab, and an unknown kind, get nothing", async () => {
  const { service } = make();
  assert.equal(await service.answer("bookmarks", undefined), undefined);
  assert.equal(await service.answer("recent", NORMAL_LINE), undefined);
});

test("the tab list is not a fetched kind any more: the tab model serves it", async () => {
  const { service } = make();
  assert.equal(await service.answer("tabs", NORMAL_LINE), undefined);
});

test("a private tab in the line's own window stays out of a normal line", () => {
  const mixed = [tab(1, 0, 10, false), tab(2, 1, 10, true)];
  assert.deepEqual(listed_tabs(mixed, { window_id: 10, incognito: false }).map((item) => item.id), [1]);
  assert.deepEqual(listed_tabs(mixed, { window_id: 10, incognito: true }).map((item) => item.id), [2]);
});

test("the line's window lists first, then the other windows by id", () => {
  const tabs = [tab(1, 0, 10, false), tab(2, 0, 11, false), tab(3, 1, 11, false)];
  assert.deepEqual(listed_tabs(tabs, { window_id: 11, incognito: false }).map((item) => item.id), [2, 3, 1]);
});

test("the number is the place in the tab bar counted from 1, current tab included", () => {
  const [first, second] = listed_tabs([tab(1, 0, 10, false), tab(2, 1, 10, false)], { window_id: 10, incognito: false });
  assert.deepEqual([first!.number, second!.number], [1, 2]);
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
  assert.deepEqual(((await service.answer("bookmarks", PRIVATE_LINE))?.items as unknown[]).length, 2);
});

test("a failed browser call gives an empty list, not an error", async () => {
  const { service } = make({ fail: true });
  assert.deepEqual(await service.answer("bookmarks", NORMAL_LINE), { items: [] });
});

test("a tab that navigates or closes while the lookup runs gets nothing", async () => {
  const opened = new Set([1]);
  const service = create_complete_items({
    query_tabs: async () => ALL_TABS,
    query_windows: async () => WINDOWS,
    all_bookmarks: async () => {
      opened.delete(1);
      return [];
    },
    is_opener: async (tab_id) => opened.has(tab_id),
    containers: async () => new Map(),
    previous_tab: async () => undefined,
    read_tab: async () => undefined,
    discard: {} as DiscardDeps,
    tab_actions: NO_ACTIONS,
    search_engines: async () => ENGINES,
    page_of: async () => undefined,
    search_history: async () => [],
    open_settings: async () => ({ sources: ["bookmarks", "history"], history_max: 10 }),
    history_list_max: async () => 20,
  });
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

const VISITS: HistoryNode[] = [
  { title: "Newest", url: "https://new.test/" },
  { title: "about", url: "about:config" },
  { title: "ext", url: "moz-extension://abc/page.html" },
  { title: "data", url: "data:text/html,hi" },
  { title: "Marked\n  page", url: "https://marked.test/" },
  { url: "https://bare.test/" },
];
const MARKS: BookmarkNode[] = [{ type: "bookmark", title: "Marked", url: "https://marked.test/", dateAdded: 5 }, { type: "bookmark", title: "Other", url: "https://other.test/", dateAdded: 4 }];

test("history items drop the skipped schemes, keep the order and one-line the titles", () => {
  assert.deepEqual(history_items(VISITS), [
    { title: "Newest", url: "https://new.test/" },
    { title: "Marked page", url: "https://marked.test/" },
    { title: "https://bare.test/", url: "https://bare.test/" },
  ]);
});

test("open rows list the bookmark once, tag each row and send every row with the cap", async () => {
  const { service } = make({ bookmarks: MARKS, history: VISITS });
  assert.deepEqual(await service.answer("open", NORMAL_LINE), {
    items: {
      history_max: 10,
      rows: [
        { title: "Marked", url: "https://marked.test/", tag: "bm" },
        { title: "Other", url: "https://other.test/", tag: "bm" },
        { title: "Newest", url: "https://new.test/", tag: "hist" },
        { title: "https://bare.test/", url: "https://bare.test/", tag: "hist" },
      ],
    },
  });
});

test("the group order follows the setting and the cap setting travels with the rows", async () => {
  const { service } = make({ bookmarks: MARKS, history: VISITS, open: { sources: ["history", "bookmarks"], history_max: 3 } });
  const answer = (await service.answer("open", NORMAL_LINE))?.items as { rows: { tag: string }[]; history_max: number };
  assert.equal(answer.history_max, 3);
  assert.deepEqual(answer.rows.map((row) => row.tag), ["hist", "hist", "bm", "bm"]);
});

test("a source left out of the setting is not read", async () => {
  const marks_only = make({ bookmarks: MARKS, history: VISITS, open: { sources: ["bookmarks"], history_max: 10 } });
  assert.equal(((await marks_only.service.answer("open", NORMAL_LINE))?.items as { rows: unknown[] }).rows.length, 2);
  assert.deepEqual(marks_only.history_reads, []);
  const history_only = make({ bookmarks: MARKS, history: VISITS, open: { sources: ["history"], history_max: 10 } });
  assert.equal(((await history_only.service.answer("open", NORMAL_LINE))?.items as { rows: { tag: string }[] }).rows.every((row) => row.tag === "hist"), true);
});

test("a private line lists bookmarks and no history, and does not read history", async () => {
  const { service, history_reads } = make({ bookmarks: MARKS, history: VISITS });
  const answer = (await service.answer("open", PRIVATE_LINE))?.items as { rows: { tag: string }[] };
  assert.deepEqual(answer.rows.map((row) => row.tag), ["bm", "bm"]);
  assert.deepEqual(history_reads, []);
});

test("a failed browser call gives no open rows", async () => {
  const { service } = make({ fail: true });
  assert.deepEqual(await service.answer("open", NORMAL_LINE), { items: { rows: [], history_max: 10 } });
});

test("the opener is checked before and after the history fetch", async () => {
  const before = make({ openers: [], history: VISITS });
  assert.equal(await before.service.answer("open", NORMAL_LINE), undefined);
  assert.deepEqual(before.history_reads, []);
  const opened = new Set([1]);
  const service = create_complete_items({
    query_tabs: async () => [],
    query_windows: async () => [],
    all_bookmarks: async () => [],
    is_opener: async (tab_id) => opened.has(tab_id),
    containers: async () => new Map(),
    previous_tab: async () => undefined,
    read_tab: async () => undefined,
    discard: {} as DiscardDeps,
    tab_actions: NO_ACTIONS,
    search_engines: async () => ENGINES,
    page_of: async () => undefined,
    search_history: async () => {
      opened.delete(1);
      return VISITS;
    },
    open_settings: async () => ({ sources: ["history"], history_max: 10 }),
    history_list_max: async () => 20,
  });
  assert.equal(await service.answer("open", NORMAL_LINE), undefined);
});

test("a failed history read leaves the bookmarks, and a failed bookmark read leaves the history", async () => {
  const service = (failing: "history" | "bookmarks") =>
    create_complete_items({
      query_tabs: async () => [],
      query_windows: async () => [],
      all_bookmarks: async () => {
        if (failing === "bookmarks") throw new Error("no bookmarks");
        return MARKS;
      },
      is_opener: async () => true,
      containers: async () => new Map(),
      previous_tab: async () => undefined,
    read_tab: async () => undefined,
    discard: {} as DiscardDeps,
    tab_actions: NO_ACTIONS,
      search_engines: async () => ENGINES,
      page_of: async () => undefined,
      search_history: async () => {
        if (failing === "history") throw new Error("no history");
        return VISITS;
      },
      open_settings: async () => ({ sources: ["bookmarks", "history"], history_max: 10 }),
      history_list_max: async () => 20,
    });
  const tags = async (failing: "history" | "bookmarks") => ((await service(failing).answer("open", NORMAL_LINE))?.items as { rows: { tag: string }[] }).rows.map((row) => row.tag);
  assert.deepEqual(await tags("history"), ["bm", "bm"]);
  assert.deepEqual(await tags("bookmarks"), ["hist", "hist", "hist"]);
});

test("the history kind lists every visit newest first with no dedup against bookmarks, and carries the cap", async () => {
  const { service } = make({ bookmarks: MARKS, history: VISITS, list_max: 7 });
  assert.deepEqual(await service.answer("history", NORMAL_LINE), {
    items: {
      rows: [
        { title: "Newest", url: "https://new.test/" },
        { title: "Marked page", url: "https://marked.test/" },
        { title: "https://bare.test/", url: "https://bare.test/" },
      ],
      max: 7,
    },
  });
});

test("a private line gets no history rows and the history is not read", async () => {
  const { service, history_reads } = make({ history: VISITS });
  assert.deepEqual(await service.answer("history", PRIVATE_LINE), { items: { rows: [], max: 20 } });
  assert.deepEqual(history_reads, []);
});

test("a failed history read gives no rows, and a tab that redeemed no ticket gets nothing", async () => {
  assert.deepEqual(await make({ fail: true }).service.answer("history", NORMAL_LINE), { items: { rows: [], max: 20 } });
  const closed = make({ openers: [], history: VISITS });
  assert.equal(await closed.service.answer("history", NORMAL_LINE), undefined);
  assert.deepEqual(closed.history_reads, []);
});

test("a history read that finishes after the line closed gives nothing", async () => {
  const opened = new Set([1]);
  const service = create_complete_items({
    query_tabs: async () => [],
    query_windows: async () => [],
    all_bookmarks: async () => [],
    is_opener: async (tab_id) => opened.has(tab_id),
    containers: async () => new Map(),
    previous_tab: async () => undefined,
    read_tab: async () => undefined,
    discard: {} as DiscardDeps,
    tab_actions: NO_ACTIONS,
    search_engines: async () => ENGINES,
    page_of: async () => undefined,
    search_history: async () => {
      opened.delete(1);
      return VISITS;
    },
    open_settings: async () => ({ sources: ["history"], history_max: 10 }),
    history_list_max: async () => 20,
  });
  assert.equal(await service.answer("history", NORMAL_LINE), undefined);
});

const FOX = { color: "#37adff", icon: "resource://usercontext-content/fingerprint.svg" };
const in_window = (id: number, extra: Partial<TabLike>): TabLike => ({ ...tab(id, id - 1, 10, false), ...extra });

test("the alternate tab is the previous tab of the line's window, and the current tab is marked", () => {
  const tabs = [in_window(1, { active: true }), in_window(2, {}), in_window(3, {}), tab(4, 0, 11, false)];
  const listed = listed_tabs(tabs, { window_id: 10, incognito: false }, new Map(), 3);
  assert.deepEqual(listed.map((item) => [item.id, item.active, item.alternate]), [[1, true, undefined], [2, undefined, undefined], [3, undefined, true], [4, undefined, undefined]]);
});

test("a previous tab moved to another window takes no alternate mark in that window's rows", () => {
  const tabs = [in_window(1, { active: true }), tab(3, 0, 11, false)];
  assert.deepEqual(listed_tabs(tabs, { window_id: 10, incognito: false }, new Map(), 3).map((item) => item.alternate), [undefined, undefined]);
});

test("a background tab never takes the alternate mark, and a closed or current previous tab marks nothing", () => {
  const scope = { window_id: 10, incognito: false };
  const opened_later = [in_window(1, { active: true }), in_window(2, {}), in_window(3, {})];
  assert.deepEqual(listed_tabs(opened_later, scope).map((item) => item.alternate), [undefined, undefined, undefined]);
  assert.deepEqual(listed_tabs(opened_later, scope, new Map(), 99).map((item) => item.alternate), [undefined, undefined, undefined]);
  assert.deepEqual(listed_tabs([in_window(1, { active: true })], scope, new Map(), 1).map((item) => item.alternate), [undefined]);
  // Another window's active tab is not the current tab of this line.
  assert.deepEqual(listed_tabs([{ ...tab(4, 0, 11, false), active: true }], scope).map((item) => item.active), [undefined]);
});

test("a muted tab that plays sound shows the muted icon only", () => {
  const [item] = listed_tabs([in_window(1, { audible: true, mutedInfo: { muted: true } })], { window_id: 10, incognito: false });
  assert.deepEqual([item!.audible, item!.muted], [undefined, true]);
});

test("the flags appear only when true", () => {
  const [plain, flagged] = listed_tabs([in_window(1, {}), in_window(2, { pinned: true, audible: true, discarded: true })], { window_id: 10, incognito: false });
  assert.deepEqual(Object.keys(plain!).sort(), ["id", "number", "title", "url", "window_id"]);
  assert.deepEqual([flagged!.pinned, flagged!.audible, flagged!.muted, flagged!.discarded], [true, true, undefined, true]);
  assert.equal(listed_tabs([in_window(1, { mutedInfo: { muted: false } })], { window_id: 10, incognito: false })[0]!.muted, undefined);
});

test("only http, https and short data: favicons go on the wire", () => {
  assert.equal(listed_favicon("https://a.test/icon.png"), "https://a.test/icon.png");
  assert.equal(listed_favicon("http://a.test/icon.png"), "http://a.test/icon.png");
  assert.equal(listed_favicon("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(listed_favicon(`data:image/png;base64,${"A".repeat(5000)}`), undefined);
  for (const dropped of ["chrome://mozapps/skin/places/defaultFavicon.svg", "moz-extension://x/icon.png", "file:///a.png", "javascript:alert(1)", "", undefined]) assert.equal(listed_favicon(dropped), undefined);
  const [item] = listed_tabs([in_window(1, { favIconUrl: "chrome://branding/content/icon32.png" })], { window_id: 10, incognito: false });
  assert.equal("favicon" in item!, false);
});

test("a container tab carries the container, and the default container, a private tab and an unknown store carry none", () => {
  const containers = new Map([["firefox-container-1", FOX]]);
  const tabs = [in_window(1, { cookieStoreId: "firefox-container-1" }), in_window(2, { cookieStoreId: "firefox-default" }), in_window(3, { cookieStoreId: "firefox-container-9" }), in_window(4, {})];
  assert.deepEqual(listed_tabs(tabs, { window_id: 10, incognito: false }, containers).map((item) => item.container), [FOX, undefined, undefined, undefined]);
  const private_tab = { ...tab(5, 0, 20, true), cookieStoreId: "firefox-private" };
  assert.equal(listed_tabs([private_tab], { window_id: 20, incognito: true }, containers)[0]!.container, undefined);
});

test("the container lookup maps identities, and gives none when containers are off", async () => {
  const identity = { cookieStoreId: "firefox-container-1", name: "Work", colorCode: FOX.color, iconUrl: FOX.icon };
  assert.deepEqual([...(await read_containers(async () => [identity]))], [["firefox-container-1", FOX]]);
  assert.deepEqual([...(await read_container_identities(async () => [identity]))], [["firefox-container-1", { name: "Work", ...FOX }]]);
  assert.equal((await read_container_identities(async () => false)).size, 0);
  assert.equal((await read_containers(async () => { throw new Error("containers are off"); })).size, 0);
  assert.equal((await read_containers(() => { throw new Error("no api"); })).size, 0);
  assert.equal((await read_containers(async () => false)).size, 0);
});

test("the row keeps the new fields and sends a long data: favicon nowhere", () => {
  const long = `data:image/png;base64,${"A".repeat(5000)}`;
  const tabs = [
    in_window(1, { active: true, favIconUrl: long, pinned: true }),
    in_window(2, { favIconUrl: "https://a.test/i.png", cookieStoreId: "firefox-container-1" }),
  ];
  const listed = listed_tabs(tabs, { window_id: 10, incognito: false }, new Map([["firefox-container-1", FOX]]), 2);
  assert.deepEqual(listed, [
    { id: 1, window_id: 10, number: 1, title: "Tab 1", url: "https://site1.test/", active: true, pinned: true },
    { id: 2, window_id: 10, number: 2, title: "Tab 2", url: "https://site2.test/", favicon: "https://a.test/i.png", container: FOX, alternate: true },
  ]);
});

test("a private line lists private tabs with their favicon and flags and no container", () => {
  const private_tabs = [{ ...tab(4, 0, 20, true), active: true, favIconUrl: "https://p.test/i.png", cookieStoreId: "firefox-private" }];
  assert.deepEqual(listed_tabs(private_tabs, { window_id: 20, incognito: true }, new Map([["firefox-container-1", FOX]])), [
    { id: 4, window_id: 20, number: 1, title: "Tab 4", url: "https://site4.test/", favicon: "https://p.test/i.png", active: true },
  ]);
});

test("a popup window is not listed, and it still counts a place so the numbers stay put", () => {
  const with_popup = [window_of(10, false, "Mail"), window_of(30, false, "Popup", "popup"), window_of(11, false, "Docs")];
  assert.deepEqual(listed_windows(with_popup, NORMAL_LINE).map(({ number, title }) => ({ number, title })), [{ number: 3, title: "Docs" }]);
});

// A tab that Firefox can discard: it keeps what it read before, as a real one does, except a loading tab loses its address.
function discardable(initial: TabLike) {
  let current: TabLike = { ...initial };
  const log: string[] = [];
  const deps: DiscardDeps = {
    read_tab: async () => ({ id: 1, window_id: 10, index: 0, active: !!current.active, audible: !!current.audible, discarded: !!current.discarded }),
    tabs_in_window: async () => [],
    alternate_of: async () => undefined,
    activate: async () => {},
    discard: async () => {
      log.push("discard");
      current = { ...current, discarded: true, url: "about:blank", title: "about:blank" };
    },
    reload: async () => {
      log.push("reload");
      current = { ...current, discarded: false, url: "https://site1.test/", title: "Tab 1" };
    },
  };
  return { deps, log, read_tab: async (id: number) => (id === 1 ? current : id === 4 ? { ...tab(4, 0, 20, true) } : undefined) };
}

// Tabs that exist, as the browser knows them. A call that names a closed tab rejects, after it acted on the others of a list.
function fake_tab_actions(existing: Set<number>) {
  const log: string[] = [];
  const act = (name: string) => async (ids: number[], ...rest: unknown[]) => {
    log.push(`${name} ${ids.join(",")}${rest.length ? ` ${rest.join(",")}` : ""}`);
    if (ids.some((id) => !existing.has(id))) throw new Error("Invalid tab ID");
  };
  const actions: TabActions = { set_muted: act("mute"), set_pinned: act("pin"), remove: async (ids) => void (await act("close")(ids)), open_tab: async (open) => void log.push(`open ${open.url} ${open.cookie_store_id} ${open.active}`) };
  return { actions, log };
}

const reading = (existing: Set<number>) => async (id: number) => (existing.has(id) ? (id >= 4 ? tab(id, 0, 20, true) : tab(id, 0, 10, false)) : undefined);

test("tab_rows_action closes, mutes and pins the ids it is given, and answers with no refusal", async () => {
  const existing = new Set([1, 2, 3]);
  const fake = fake_tab_actions(existing);
  const { service } = make({ read_tab: reading(existing), tab_actions: fake.actions });
  assert.deepEqual(await service.tab_rows_action("close", [2, 3], NORMAL_LINE), {});
  assert.deepEqual(await service.tab_rows_action("mute", [2, 3], NORMAL_LINE), {});
  assert.deepEqual(await service.tab_rows_action("unmute", [2], NORMAL_LINE), {});
  assert.deepEqual(await service.tab_rows_action("pin", [3], NORMAL_LINE), {});
  assert.deepEqual(await service.tab_rows_action("unpin", [3, 3], NORMAL_LINE), {});
  assert.deepEqual(fake.log, ["close 2", "close 3", "mute 2,3 true", "mute 2 false", "pin 3 true", "pin 3 false"]);
});

test("tab_rows_action skips a selected tab that is already gone and acts on the rest", async () => {
  const existing = new Set([2, 3]);
  const fake = fake_tab_actions(existing);
  const { service } = make({ read_tab: reading(existing), tab_actions: fake.actions });
  assert.deepEqual(await service.tab_rows_action("close", [99, 2, 3], NORMAL_LINE), {});
  assert.deepEqual(fake.log, ["close 2", "close 3"]);
});

test("tab_rows_action closes the rest when one tab closes during the action", async () => {
  const existing = new Set([2, 3]);
  const fake = fake_tab_actions(new Set([3]));
  const { service } = make({ read_tab: reading(existing), tab_actions: fake.actions });
  assert.deepEqual(await service.tab_rows_action("close", [2, 3], NORMAL_LINE), {});
  assert.deepEqual(fake.log, ["close 2", "close 3"]);
});

test("tab_rows_action reports a mute that failed because a tab closed during it", async () => {
  const existing = new Set([2, 3]);
  const fake = fake_tab_actions(new Set([3]));
  const { service } = make({ read_tab: reading(existing), tab_actions: fake.actions });
  assert.deepEqual(await service.tab_rows_action("mute", [2, 3], NORMAL_LINE), { refusal: "a tab changed before the action ran" });
  assert.deepEqual(fake.log, ["mute 2,3 true"]);
});

test("tab_rows_action unloads and loads, and names what Firefox refused", async () => {
  const tab_1 = discardable(tab(1, 0, 10, false));
  const { service } = make({ read_tab: tab_1.read_tab, discard: tab_1.deps });
  assert.deepEqual(await service.tab_rows_action("unload", [1], { ...NORMAL_LINE, tab_id: 2 }), {});
  assert.deepEqual(await service.tab_rows_action("load", [1], { ...NORMAL_LINE, tab_id: 2 }), {});
  assert.deepEqual(tab_1.log, ["discard", "reload"]);
  const playing = discardable({ ...tab(1, 0, 10, false), audible: true });
  const { service: refusing } = make({ read_tab: playing.read_tab, discard: playing.deps });
  assert.deepEqual(await refusing.tab_rows_action("unload", [1], NORMAL_LINE), { refusal: "unloaded 0 tabs, skipped 1 (audible)" });
  assert.deepEqual(playing.log, []);
});

test("tab_rows_action answers nothing for a line without a ticket, and runs nothing", async () => {
  const existing = new Set([2]);
  const fake = fake_tab_actions(existing);
  const { service } = make({ openers: [], read_tab: reading(existing), tab_actions: fake.actions });
  assert.equal(await service.tab_rows_action("close", [2], NORMAL_LINE), undefined);
  assert.equal(await service.tab_rows_action("close", [2], undefined), undefined);
  assert.deepEqual(fake.log, []);
});

test("tab_rows_action refuses a ticket that was used after the line closed", async () => {
  const existing = new Set([2, 3]);
  const fake = fake_tab_actions(existing);
  const { service, opened } = make({ read_tab: reading(existing), tab_actions: fake.actions });
  assert.deepEqual(await service.tab_rows_action("close", [2], NORMAL_LINE), {});
  opened.delete(NORMAL_LINE.tab_id);
  assert.equal(await service.tab_rows_action("close", [3], NORMAL_LINE), undefined);
  assert.deepEqual(fake.log, ["close 2"]);
});

test("tab_rows_action refuses the whole message when one id is a tab of the other privacy", async () => {
  const existing = new Set([2, 4]);
  const fake = fake_tab_actions(existing);
  const { service } = make({ read_tab: reading(existing), tab_actions: fake.actions });
  assert.equal(await service.tab_rows_action("close", [2, 4], NORMAL_LINE), undefined);
  assert.equal(await service.tab_rows_action("mute", [4], NORMAL_LINE), undefined);
  assert.deepEqual(fake.log, []);
  assert.deepEqual(await service.tab_rows_action("close", [4], PRIVATE_LINE), {});
  assert.deepEqual(fake.log, ["close 4"]);
});

test("tab_rows_action refuses a bad action or id list", async () => {
  const existing = new Set([2]);
  const fake = fake_tab_actions(existing);
  const { service } = make({ read_tab: reading(existing), tab_actions: fake.actions });
  for (const [action, ids] of [["bury", [2]], [undefined, [2]], ["close", "2"], ["close", ["2"]], ["close", [1.5]], ["close", Array.from({ length: 5001 }, (_, id) => id)]] as const) {
    assert.equal(await service.tab_rows_action(action, ids, NORMAL_LINE), undefined);
  }
  assert.deepEqual(fake.log, []);
});

test("tab_rows_action refuses when the line loses its ticket while the tabs are read", async () => {
  const existing = new Set([2]);
  const fake = fake_tab_actions(existing);
  let service: ReturnType<typeof make>["service"] | undefined;
  const made = make({
    read_tab: async (id) => {
      made.opened.delete(NORMAL_LINE.tab_id);
      return reading(existing)(id);
    },
    tab_actions: fake.actions,
  });
  service = made.service;
  assert.equal(await service.tab_rows_action("close", [2], NORMAL_LINE), undefined);
  assert.deepEqual(fake.log, []);
});

// Tabs 2 to 5 sit in window 10 with their own addresses. Tab 1 is the line's own.
const in_store = (id: number, store: string | undefined): TabLike => ({ ...tab(id, id, 10, false), cookieStoreId: store });
const READING_STORES = (stores: Record<number, string | undefined>) => async (id: number) => (id in stores ? in_store(id, stores[id]) : undefined);
const WORK = new Map([["firefox-container-1", { color: "blue", icon: "briefcase" }]]);

test("tab_rows_action reopens the tabs in a container, leaving out the line's own tab and the tabs already there", async () => {
  const fake = fake_tab_actions(new Set([1, 2, 3, 4]));
  const { service } = make({ read_tab: READING_STORES({ 1: undefined, 2: undefined, 3: "firefox-container-1", 4: "firefox-default" }), tab_actions: fake.actions, containers: WORK });
  assert.deepEqual(await service.tab_rows_action("reopen", [1, 2, 3, 4], NORMAL_LINE, "firefox-container-1"), { refusal: "reopened 2, 1 already there, line tab left out" });
  assert.deepEqual(fake.log, ["open https://site2.test/ firefox-container-1 false", "close 2", "open https://site4.test/ firefox-container-1 false", "close 4"]);
});

test("tab_rows_action reopens with no note when every tab moves, into the default store too", async () => {
  const fake = fake_tab_actions(new Set([2, 3]));
  const { service } = make({ read_tab: READING_STORES({ 2: "firefox-container-1", 3: "firefox-container-1" }), tab_actions: fake.actions, containers: WORK });
  assert.deepEqual(await service.tab_rows_action("reopen", [2, 3], NORMAL_LINE, "firefox-default"), {});
  assert.deepEqual(fake.log, ["open https://site2.test/ firefox-default false", "close 2", "open https://site3.test/ firefox-default false", "close 3"]);
});

test("tab_rows_action goes on past a tab that fails to reopen and counts the rest", async () => {
  const log: string[] = [];
  const actions: TabActions = {
    ...NO_ACTIONS,
    open_tab: async (open) => {
      if (open.url.includes("site3")) throw new Error("privileged page");
      log.push(`open ${open.url} ${open.active}`);
    },
    remove: async (ids) => void log.push(`close ${ids.join(",")}`),
  };
  const { service } = make({ read_tab: READING_STORES({ 2: undefined, 3: undefined, 4: undefined }), tab_actions: actions, containers: WORK });
  assert.deepEqual(await service.tab_rows_action("reopen", [2, 3, 4], NORMAL_LINE, "firefox-container-1"), { refusal: "reopened 2, 1 failed" });
  assert.deepEqual(log, ["open https://site2.test/ false", "close 2", "open https://site4.test/ false", "close 4"]);
});

test("tab_rows_action does not reopen a tab that closed before the message arrived", async () => {
  const fake = fake_tab_actions(new Set([2]));
  const { service } = make({ read_tab: READING_STORES({ 2: undefined }), tab_actions: fake.actions, containers: WORK });
  assert.deepEqual(await service.tab_rows_action("reopen", [2, 99], NORMAL_LINE, "firefox-container-1"), {});
  assert.deepEqual(fake.log, ["open https://site2.test/ firefox-container-1 false", "close 2"]);
});

test("tab_rows_action refuses a reopen with an unknown or missing store id, and runs nothing", async () => {
  const fake = fake_tab_actions(new Set([2]));
  const { service } = make({ read_tab: READING_STORES({ 2: undefined }), tab_actions: fake.actions, containers: WORK });
  assert.equal(await service.tab_rows_action("reopen", [2], NORMAL_LINE, "firefox-container-99"), undefined);
  assert.equal(await service.tab_rows_action("reopen", [2], NORMAL_LINE, undefined), undefined);
  assert.equal(await service.tab_rows_action("reopen", [2], NORMAL_LINE, 7), undefined);
  assert.deepEqual(fake.log, []);
});

test("tab_rows_action refuses a reopen from a ticketless sender, with foreign ids, and from a private line", async () => {
  const fake = fake_tab_actions(new Set([2, 4]));
  const stores = { 2: undefined, 4: undefined };
  const read_tab = async (id: number) => (id === 4 ? { ...tab(4, 0, 20, true) } : id in stores ? in_store(id, undefined) : undefined);
  const { service } = make({ read_tab, tab_actions: fake.actions, containers: WORK });
  assert.equal(await service.tab_rows_action("reopen", [2, 4], NORMAL_LINE, "firefox-container-1"), undefined);
  assert.equal(await service.tab_rows_action("reopen", [4], PRIVATE_LINE, "firefox-default"), undefined);
  const { service: ticketless } = make({ openers: [], read_tab, tab_actions: fake.actions, containers: WORK });
  assert.equal(await ticketless.tab_rows_action("reopen", [2], NORMAL_LINE, "firefox-container-1"), undefined);
  assert.equal(await ticketless.tab_rows_action("reopen", [2], undefined, "firefox-container-1"), undefined);
  assert.deepEqual(fake.log, []);
});

test("tab_rows_action names the tabs that were already there when none moved", async () => {
  const fake = fake_tab_actions(new Set([2, 3]));
  const { service } = make({ read_tab: READING_STORES({ 2: "firefox-container-1", 3: "firefox-container-1" }), tab_actions: fake.actions, containers: WORK });
  assert.deepEqual(await service.tab_rows_action("reopen", [2, 3], NORMAL_LINE, "firefox-container-1"), { refusal: "reopened 0, 2 already there" });
  assert.deepEqual(fake.log, []);
});

test("tab_rows_action refuses a reopen when the line loses its ticket during the container lookup", async () => {
  const fake = fake_tab_actions(new Set([2]));
  let close_line = () => {};
  const { service, opened } = make({ read_tab: READING_STORES({ 2: undefined }), tab_actions: fake.actions, containers: WORK, on_containers: () => close_line() });
  close_line = () => opened.delete(NORMAL_LINE.tab_id);
  assert.equal(await service.tab_rows_action("reopen", [2], NORMAL_LINE, "firefox-container-1"), undefined);
  assert.deepEqual(fake.log, []);
});
