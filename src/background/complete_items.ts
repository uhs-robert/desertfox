// The tabs, bookmarks, engines and windows the command line page lists for `tab`, `bookmark`, `search` and `tab.attach`. That page cannot read them itself: only the
// background knows which tab asked, so only it can keep private tabs out of a normal line and refuse a page that never opened a line.
// The pure readers here (`listed_tabs`, `flatten_bookmarks`, `bookmark_items`) are also imported by the new tab page, which reads its own lists and filters private tabs itself (`newtab/lists.ts`).

import type { SearchEngine } from "../shared/config.ts";
import type { PageInfo } from "../shared/engines/index.ts";
import type { AnythingItems, BookmarkItem, BookmarkRows, Boosted, ClosedTabRow, CompleteItemsAnswer, EngineItem, FolderItem, HistoryItem, HistoryItems, OpenRow, RegisterItem, SessionItem, SiteItem, TabContainer, TabItem, TabRowsAction, TabRowsActionAnswer, WindowItem } from "../shared/messages.ts";
import { available_engine_names } from "./availability.ts";
import { FOLDER_PATH_SEPARATOR } from "../shared/folder_pick.ts";
import { DEFAULT_COOKIE_STORE_ID } from "../shared/container_store.ts";
import { close_tabs, reopen_tabs_in_container, set_muted, set_pinned } from "./tab_actions.ts";
import type { TabActionDeps } from "./tab_actions.ts";
import { describe_result, set_unloaded } from "./tab_discard.ts";
import type { DiscardDeps } from "./tab_discard.ts";
import { history_cache, history_row } from "./history_cache.ts";
import { MAX_BOOST } from "../shared/score.ts";
import { browser_register_store } from "./register_store.ts";
import { browser_session_storage, make_session_store } from "./session_store.ts";

export type TabLike = {
  id?: number | undefined;
  index: number;
  windowId?: number | undefined;
  title?: string | undefined;
  url?: string | undefined;
  incognito: boolean;
  favIconUrl?: string | undefined;
  cookieStoreId?: string | undefined;
  active?: boolean | undefined;
  pinned?: boolean | undefined;
  audible?: boolean | undefined;
  mutedInfo?: { muted?: boolean | undefined } | undefined;
  discarded?: boolean | undefined;
  splitViewId?: number | undefined;
  lastAccessed?: number | undefined;
};

// The containers by cookie store id, as `contextualIdentities` names them.
export type ContainerMarks = ReadonlyMap<string, TabContainer>;

// A longer data: favicon costs more on the wire than the mark is worth, and the row falls back to the plain glyph.
const MAX_DATA_FAVICON = 2048;

// Only what an extension page can load and that is cheap to send. A chrome: favicon would fail to load in the page anyway.
export function listed_favicon(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return /^data:/i.test(url) && url.length <= MAX_DATA_FAVICON ? url : undefined;
}

// A tab the line can list. The page gets `TabItem` only.
export type ListedTab = TabItem & { window_id: number };

// The window and privacy of the tab that holds the line.
export type LineScope = { window_id: number; incognito: boolean };

export type WindowLike = {
  id?: number | undefined;
  // Only `normal` windows hold movable tabs. Popup, panel and app windows are skipped.
  type?: string | undefined;
  incognito: boolean;
  tabs?: { active?: boolean | undefined; title?: string | undefined; url?: string | undefined; lastAccessed?: number | undefined }[] | undefined;
};

// A window the line can offer. The page gets `WindowItem` only.
export type NumberedWindow = WindowItem & { id: number; incognito: boolean; last_used: number };

export type BookmarkNode = { id?: string | undefined; unmodifiable?: string | undefined; type?: string | undefined; title?: string | undefined; url?: string | undefined; dateAdded?: number | undefined; children?: BookmarkNode[] | undefined };

const one_line = (text: string) => text.replace(/\s+/g, " ").trim();

// A normal line lists only normal tabs and a private line only private tabs. The line's own window comes first, so
// that is where a number lands when several windows are listed.
export function listed_tabs(tabs: readonly TabLike[], scope: LineScope, containers: ContainerMarks = new Map(), previous_tab_id?: number): ListedTab[] {
  const shown = tabs.filter((tab) => tab.id !== undefined && tab.windowId !== undefined && tab.incognito === scope.incognito);
  return shown
    .map((tab): ListedTab => {
      const favicon = listed_favicon(tab.favIconUrl);
      const container = tab.cookieStoreId === undefined ? undefined : containers.get(tab.cookieStoreId);
      return {
        id: tab.id as number,
        window_id: tab.windowId as number,
        number: tab.index + 1,
        title: one_line(tab.title || tab.url || ""),
        url: tab.url ?? "",
        ...(favicon ? { favicon } : {}),
        ...(container ? { container } : {}),
        // Another window's active tab is not the current one, so only the line's window marks `%` and `#`.
        ...(tab.active && tab.windowId === scope.window_id ? { active: true as const } : {}),
        // `previous_tab_id` is the line's window's, but a tab moved to another window keeps its id, so only the line's window marks `#`. A closed tab is not in `shown`, so it marks nothing.
        ...(tab.id === previous_tab_id && !tab.active && tab.windowId === scope.window_id ? { alternate: true as const } : {}),
        ...(tab.pinned ? { pinned: true as const } : {}),
        // A muted tab that plays sound is audible too, and the speaker would contradict the crossed one.
        ...(tab.audible && !tab.mutedInfo?.muted ? { audible: true as const } : {}),
        ...(tab.mutedInfo?.muted ? { muted: true as const } : {}),
        ...(tab.discarded ? { discarded: true as const } : {}),
        ...(tab.splitViewId !== undefined && tab.splitViewId !== -1 ? { split: true as const } : {}),
      };
    })
    .sort((a, b) => Number(b.window_id === scope.window_id) - Number(a.window_id === scope.window_id) || a.window_id - b.window_id || a.number - b.number);
}

// Every normal window with its place in `windows.getAll` (popups still count a place, so numbers stay stable), whatever its privacy: a typed number for a window the list hides still has to be found, to be refused by name.
export function numbered_windows(windows: readonly WindowLike[]): NumberedWindow[] {
  return windows.flatMap((window, place) => {
    if (window.id === undefined || window.type !== "normal") return [];
    const active = window.tabs?.find((tab) => tab.active);
    return [{ id: window.id, incognito: window.incognito, number: place + 1, title: one_line(active?.title || active?.url || ""), last_used: active?.lastAccessed ?? 0 }];
  });
}

// The windows of the line's own privacy, without the line's own window.
export const listed_windows = (windows: readonly WindowLike[], scope: LineScope): NumberedWindow[] =>
  numbered_windows(windows).filter((window) => window.incognito === scope.incognito && window.id !== scope.window_id);

// Every node of the bookmark tree, folders included, newest added first. `getTree` has no cap, unlike `getRecent`, so an old bookmark still opens.
export function flatten_bookmarks(roots: readonly BookmarkNode[]): BookmarkNode[] {
  const flat: BookmarkNode[] = [];
  const walk = (nodes: readonly BookmarkNode[]) => {
    for (const node of nodes) {
      flat.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(roots);
  return flat.sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0));
}

// A folder of the tree with its path from the root, and the bookmarks directly inside it (no subfolders). The titles are display text Firefox localizes, so two folders can share a path.
export type FolderNode = { id: string; path: string; managed: boolean; bookmarks: BookmarkNode[] };

// Every folder below the tree's own root, in tree order. The root has no title and holds the four toolbar, menu, other and mobile folders, which are folders too.
export function folder_nodes(roots: readonly BookmarkNode[]): FolderNode[] {
  const folders: FolderNode[] = [];
  const walk = (nodes: readonly BookmarkNode[], parent_path: string) => {
    for (const node of nodes) {
      if (!node.children || node.id === undefined) continue;
      const title = one_line(node.title ?? "");
      const path = parent_path === "" ? title : `${parent_path}${FOLDER_PATH_SEPARATOR}${title}`;
      folders.push({ id: node.id, path, managed: node.unmodifiable !== undefined, bookmarks: node.children.filter(is_bookmark_node) });
      walk(node.children, path);
    }
  };
  for (const root of roots) walk(root.children ?? [], "");
  return folders;
}

export const folder_items = (folders: readonly FolderNode[]): FolderItem[] =>
  folders.map((folder) => ({ name: folder.path, description: `${folder.bookmarks.length} ${folder.bookmarks.length === 1 ? "bookmark" : "bookmarks"}` }));

// A bookmark proper: not a folder or a separator, and it has an address.
export const is_bookmark_node = (node: BookmarkNode): node is BookmarkNode & { url: string } => (node.type === undefined || node.type === "bookmark") && !!node.url;

// Newest first, as `flatten_bookmarks` gives them. Folders, separators and a repeated address drop out.
export function bookmark_items(nodes: readonly BookmarkNode[]): BookmarkItem[] {
  const seen = new Set<string>();
  const items: BookmarkItem[] = [];
  for (const node of nodes) {
    if (!is_bookmark_node(node) || seen.has(node.url)) continue;
    seen.add(node.url);
    items.push({ title: one_line(node.title || node.url), url: node.url });
  }
  return items;
}

// The `bookmark` list: `bookmark_items` rows, each with the folders that hold a copy of its address, newest copy first. Every folder is listed, so a row's index is its place in `folders`.
export function bookmark_rows(nodes: readonly BookmarkNode[], folders: readonly FolderNode[], usage: Usage = new Map()): BookmarkRows {
  const copies = new Map<string, { added: number; folder: number }[]>();
  folders.forEach((folder, index) => {
    for (const node of folder.bookmarks) copies.set(node.url as string, [...(copies.get(node.url as string) ?? []), { added: node.dateAdded ?? 0, folder: index }]);
  });
  const rows = with_usage(bookmark_items(nodes), usage).map((item) => ({
    ...item,
    folders: [...new Set((copies.get(item.url) ?? []).sort((a, b) => b.added - a.added).map((copy) => copy.folder))],
  }));
  return { rows, folders: folders.map((folder) => folder.path) };
}

// What a `bookmark` command and the list both read from one `getTree`: the rows with their folder indexes, and the folder nodes (ids included) those indexes point into.
export type BookmarkView = { rows: BookmarkRows; folders: FolderNode[] };

export function bookmark_view(roots: readonly BookmarkNode[], usage: Usage = new Map()): BookmarkView {
  const folders = folder_nodes(roots);
  return { rows: bookmark_rows(flatten_bookmarks(roots), folders, usage), folders };
}

// A visit to these is no page the user would open from the line.
const SKIPPED_SCHEMES = /^(about|moz-extension|data):/i;

export type HistoryNode = { title?: string | undefined; url?: string | undefined; visit_count?: number | undefined; last_visit?: number | undefined };

// The usage boost: half from how often a page was visited and half from how recently. Firefox gives only the count and the last visit per page, not the visit list its own frecency reads.
// The count weighs by its log, so the 50th visit adds little over the 10th, and the recency halves every two weeks.
const COUNT_WEIGHT = MAX_BOOST / 2;
const RECENCY_WEIGHT = MAX_BOOST / 2;
const FULL_COUNT = 50;
const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
// An open tab is a page in use now. Its own visits add to this, up to `MAX_BOOST`.
export const OPEN_TAB_BOOST = 0.3;

// Two decimals: the rank needs no more, and 8000 rows go to the page in each answer.
const rounded_boost = (boost: number) => Math.round(Math.min(MAX_BOOST, boost) * 100) / 100;

export function usage_boost(visit_count: number, last_visit: number, now: number): number {
  const count = Math.min(1, Math.log1p(Math.max(0, visit_count)) / Math.log1p(FULL_COUNT));
  // A last visit of 0 is unknown, so its recency is 0. A clock set back must not raise it past 1.
  const recency = last_visit > 0 ? 0.5 ** (Math.max(0, now - last_visit) / RECENCY_HALF_LIFE_MS) : 0;
  return rounded_boost(COUNT_WEIGHT * count + RECENCY_WEIGHT * recency);
}

const boosted = (boost: number | undefined): Boosted => (boost ? { boost } : {});

// The boost of each visited address, for rows from other sources that show the same page.
export type Usage = ReadonlyMap<string, number>;

export const usage_by_url = (history: readonly HistoryItem[]): Usage => new Map(history.flatMap((item) => (item.boost ? [[item.url, item.boost]] : [])));

export const with_usage = <Item extends { url: string }>(items: readonly Item[], usage: Usage): (Item & Boosted)[] => items.map((item) => ({ ...item, ...boosted(usage.get(item.url)) }));

// Newest first, as `history.search` gives them. Skipped schemes drop out.
export function history_items(nodes: readonly HistoryNode[], now = Date.now()): HistoryItem[] {
  return nodes
    .filter((node): node is HistoryNode & { url: string } => !!node.url && !SKIPPED_SCHEMES.test(node.url))
    .map((node) => ({ title: one_line(node.title || node.url), url: node.url, ...boosted(usage_boost(node.visit_count ?? 0, node.last_visit ?? 0, now)) }));
}

const WEB_ADDRESS = /^(https?):\/\/([^/?#]+)/i;

// The home page of every visited web host, with the visits of all its pages, the busiest first. http and https pages of a host count as one, at the scheme of its newest page.
// A host whose home page is already in `listed`, at either scheme, is left out: that row stands for it.
export function site_items(nodes: readonly HistoryNode[], listed: ReadonlySet<string>, now = Date.now()): SiteItem[] {
  const hosts = new Map<string, { scheme: string; visit_count: number; last_visit: number }>();
  for (const node of nodes) {
    const [, scheme, host] = node.url?.match(WEB_ADDRESS) ?? [];
    if (!scheme || !host) continue;
    const key = host.toLowerCase();
    const last_visit = node.last_visit ?? 0;
    const known = hosts.get(key) ?? { scheme: scheme.toLowerCase(), visit_count: 0, last_visit };
    hosts.set(key, {
      scheme: last_visit > known.last_visit ? scheme.toLowerCase() : known.scheme,
      visit_count: known.visit_count + (node.visit_count ?? 1),
      last_visit: Math.max(known.last_visit, last_visit),
    });
  }
  return [...hosts]
    .filter(([host]) => !listed.has(`https://${host}/`) && !listed.has(`http://${host}/`))
    .map(([host, site]) => ({ url: `${site.scheme}://${host}/`, boost: usage_boost(site.visit_count, site.last_visit, now) }))
    .sort((left, right) => right.boost - left.boost);
}

// A tab of a closed-tab session with an address worth opening again. Newest first, as `getRecentlyClosed` gives them. Windows and tabs with no session id drop out.
export type ClosedSession = { tab?: { sessionId?: string | undefined; title?: string | undefined; url?: string | undefined } | undefined };

export function closed_tab_rows(sessions: readonly ClosedSession[]): ClosedTabRow[] {
  return sessions.flatMap(({ tab }) => (tab?.sessionId && tab.url && !SKIPPED_SCHEMES.test(tab.url) ? [{ session_id: tab.sessionId, title: one_line(tab.title || tab.url), url: tab.url }] : []));
}

// Each tab of the privacy asked for, with the time it was last active.
export const tab_use_times = (tabs: readonly TabLike[], incognito: boolean): Record<number, number> =>
  Object.fromEntries(tabs.filter((tab) => tab.id !== undefined && tab.incognito === incognito).map((tab) => [tab.id as number, tab.lastAccessed ?? 0]));

export type OpenSource = "bookmarks" | "history";

export type OpenSettings = { sources: readonly OpenSource[]; history_max: number };

// Rows in the order of `sources`. A history row whose address is a bookmark drops out, so the address shows once, as the bookmark, which takes the history row's boost.
export function open_rows(sources: readonly OpenSource[], bookmarks: readonly BookmarkItem[], history: readonly HistoryItem[]): OpenRow[] {
  const bookmarked = new Set(bookmarks.map((bookmark) => bookmark.url));
  const groups: Record<OpenSource, OpenRow[]> = {
    bookmarks: with_usage(bookmarks, usage_by_url(history)).map((bookmark) => ({ ...bookmark, tag: "bm" })),
    history: history.filter((item) => !bookmarked.has(item.url)).map((item) => ({ ...item, tag: "hist" })),
  };
  return sources.flatMap((source) => groups[source]);
}

// Every engine in config order. The flag says whether the page can fill it, so the list can mark the rest. The page URL is read here and goes no further.
export function engine_items(engines: Record<string, SearchEngine>, page: PageInfo | undefined): EngineItem[] {
  const available = new Set(available_engine_names(engines, page));
  return Object.entries(engines).map(([name, engine]) => ({ name, label: engine.label, available: available.has(name), ...(engine.keyword === undefined ? {} : { keyword: engine.keyword }) }));
}

export type TabQuery = (window_id: number | undefined) => Promise<TabLike[]>;

export const read_tabs = async (query: TabQuery, scope: LineScope, all_windows: boolean, containers?: ContainerMarks, previous_tab_id?: number): Promise<ListedTab[]> =>
  listed_tabs(await query(all_windows ? undefined : scope.window_id), scope, containers, previous_tab_id);

type IdentityLike = { cookieStoreId: string; name: string; colorCode: string; iconUrl: string };
type IdentityQuery = () => Promise<readonly IdentityLike[] | false>;

export type ContainerIdentity = TabContainer & { name: string };

// With containers off the query rejects or answers false, and no tab gets a mark. The default container never appears in the answer.
export async function read_container_identities(query: IdentityQuery): Promise<ReadonlyMap<string, ContainerIdentity>> {
  const identities = await Promise.resolve().then(query).catch(() => false as const);
  return new Map(Array.isArray(identities) ? identities.map((identity) => [identity.cookieStoreId, { name: identity.name, color: identity.colorCode, icon: identity.iconUrl }]) : []);
}

// The marks without the name, which the line's rows do not show.
export async function read_containers(query: IdentityQuery): Promise<ContainerMarks> {
  return new Map([...(await read_container_identities(query))].map(([id, { color, icon }]) => [id, { color, icon }]));
}

const FALLBACK_HISTORY_ROWS = 1000;

// The cache holds up to 8,000 rows. Before its fill ends the newest 1,000 come from the browser, so a line never waits. `startTime: 0` reaches all history, since the default is the last day.
const search_history = async (): Promise<readonly HistoryNode[]> =>
  history_cache.read() ?? (await browser.history.search({ text: "", startTime: 0, maxResults: FALLBACK_HISTORY_ROWS })).flatMap((visit) => history_row(visit) ?? []);

export const browser_complete_items_deps = {
  query_tabs: ((window_id) => browser.tabs.query(window_id === undefined ? {} : { windowId: window_id })) as TabQuery,
  query_windows: (async () => browser.windows.getAll({ populate: true })) as () => Promise<WindowLike[]>,
  all_bookmarks: async (): Promise<BookmarkNode[]> => flatten_bookmarks(await browser.bookmarks.getTree()),
  folders: async (): Promise<FolderNode[]> => folder_nodes(await browser.bookmarks.getTree()),
  // A private line reads no history, so its rows rank by text alone. The `bookmark` command passes the privacy of its tab, so its Enter ranks as the list does.
  bookmark_view: async (is_private: boolean): Promise<BookmarkView> => {
    const [roots, history] = await Promise.all([browser.bookmarks.getTree(), is_private ? [] : search_history().catch(() => [])]);
    return bookmark_view(roots, usage_by_url(history_items(history)));
  },
  search_history,
  containers: (): Promise<ContainerMarks> => read_containers(() => browser.contextualIdentities.query({})),
  sessions: (): Promise<SessionItem[]> => make_session_store(browser_session_storage).items(),
  registers: (is_private: boolean): Promise<RegisterItem[]> => browser_register_store.items(is_private),
  closed_tabs: async (): Promise<ClosedTabRow[]> => closed_tab_rows(await browser.sessions.getRecentlyClosed()),
};

export type CompleteItemsDeps = typeof browser_complete_items_deps & {
  // Whether the frame of the tab redeemed a ticket, and the tab has not closed or navigated since.
  is_opener: (tab_id: number, frame_id: number) => Promise<boolean>;
  // The tab the line's window was on before its current one.
  previous_tab: (window_id: number) => Promise<number | undefined>;
  search_engines: () => Promise<Record<string, SearchEngine>>;
  // The page of the line's tab, undefined when it has none.
  page_of: (tab_id: number) => Promise<PageInfo | undefined>;
  // The marks of the page at `url` then the global ones, and the quickmarks, as list rows: the key and the text the which-key rows show.
  marks: (url: string | undefined, is_private: boolean) => Promise<RegisterItem[]>;
  quickmarks: (is_private: boolean) => Promise<RegisterItem[]>;
  // The levels the site player of the line's tab offers now, behind the fixed words.
  quality_levels: (tab_id: number) => Promise<RegisterItem[]>;
  // Only the quickmarks this window may delete.
  saved_quickmarks: (is_private: boolean) => Promise<RegisterItem[]>;
  // The quickmarks this window opens, key to full address.
  quickmark_table: (is_private: boolean) => Promise<Record<string, string>>;
  open_settings: () => Promise<OpenSettings>;
  history_list_max: () => Promise<number>;
  read_tab: (tab_id: number) => Promise<TabLike | undefined>;
  discard: DiscardDeps;
  tab_actions: Pick<TabActionDeps, "set_muted" | "set_pinned" | "remove" | "open_tab">;
};

const TAB_ROWS_ACTIONS: readonly string[] = ["close", "unload", "load", "mute", "unmute", "pin", "unpin", "reopen"] satisfies TabRowsAction[];
const is_tab_rows_action = (action: unknown): action is TabRowsAction => typeof action === "string" && TAB_ROWS_ACTIONS.includes(action);
// A bound on one message, far above any real tab count.
const MAX_ACTION_TABS = 5000;

export type Asker = LineScope & { tab_id: number; frame_id: number };

export function create_complete_items(deps: CompleteItemsDeps) {
  const open_items = async (asker: Asker) => {
    const { sources, history_max } = await deps.open_settings();
    const bookmarks = sources.includes("bookmarks") ? bookmark_items(await deps.all_bookmarks().catch(() => [])) : [];
    // One source failing leaves the other. Firefox records no private visit, so a private line lists none of the normal history either.
    const visits = sources.includes("history") && !asker.incognito ? await deps.search_history().catch(() => []) : [];
    const history = history_items(visits);
    const rows = open_rows(sources, bookmarks, history);
    return { rows, history_max, sites: site_items(visits, new Set(rows.map((row) => row.url))) };
  };

  // A private line lists nothing, as in `open_items`, and the `history` command refuses there.
  const history_list = async (asker: Asker): Promise<HistoryItems> => ({
    rows: asker.incognito ? [] : history_items(await deps.search_history().catch(() => [])),
    max: await deps.history_list_max(),
  });

  // Everything the finder lists but the open tabs, which the page takes from the tab model. Each source that fails leaves the others.
  // A private line gets quickmarks and bookmarks only: Firefox records no private visit, and the closed tabs and sessions are hidden there as in `session`.
  const anything_items = async (asker: Asker): Promise<AnythingItems> => {
    const [quickmarks, bookmarks, visits, closed, tabs, history_max] = await Promise.all([
      deps.quickmark_table(asker.incognito).catch((): Record<string, string> => ({})),
      deps.all_bookmarks().then(bookmark_items, () => []),
      asker.incognito ? [] : deps.search_history().catch(() => []),
      asker.incognito ? [] : deps.closed_tabs().catch((): ClosedTabRow[] => []),
      deps.query_tabs(undefined).catch((): TabLike[] => []),
      deps.open_settings().then(({ history_max }) => history_max, () => 0),
    ]);
    const history = history_items(visits);
    const usage = usage_by_url(history);
    const tab_boost = Object.fromEntries(
      tabs.filter((tab) => tab.id !== undefined && tab.incognito === asker.incognito).map((tab) => [tab.id as number, rounded_boost(OPEN_TAB_BOOST + (usage.get(tab.url ?? "") ?? 0))]),
    );
    const quickmark_rows = Object.entries(quickmarks).sort(([left], [right]) => (left < right ? -1 : 1)).map(([key, url]) => ({ key, url }));
    const listed = new Set([...quickmark_rows, ...bookmarks, ...history].map((row) => row.url));
    return {
      tab_used: tab_use_times(tabs, asker.incognito),
      tab_boost,
      sites: site_items(visits, listed),
      quickmarks: with_usage(quickmark_rows, usage),
      bookmarks: with_usage(bookmarks, usage),
      history,
      closed: with_usage(closed, usage),
      history_max,
    };
  };

  const fetch_items = async (kind: "bookmarks" | "engines" | "history" | "open" | "windows" | "sessions" | "registers" | "folders" | "marks" | "quickmarks" | "saved_quickmarks" | "quality_levels" | "anything", asker: Asker): Promise<CompleteItemsAnswer["items"]> => {
    // The set is read once per line. The line is modal over one tab, so the page cannot change under it.
    if (kind === "engines") return engine_items(await deps.search_engines(), await deps.page_of(asker.tab_id));
    if (kind === "open") return open_items(asker);
    if (kind === "anything") return anything_items(asker);
    if (kind === "history") return history_list(asker);
    // A private line lists no sessions, as the commands refuse there.
    if (kind === "sessions") return asker.incognito ? [] : deps.sessions();
    if (kind === "registers") return deps.registers(asker.incognito);
    if (kind === "marks") return deps.marks((await deps.page_of(asker.tab_id))?.url, asker.incognito);
    if (kind === "quality_levels") return deps.quality_levels(asker.tab_id);
    if (kind === "quickmarks") return deps.quickmarks(asker.incognito);
    if (kind === "saved_quickmarks") return deps.saved_quickmarks(asker.incognito);
    if (kind === "folders") return folder_items(await deps.folders());
    if (kind === "windows") return listed_windows(await deps.query_windows(), asker).map(({ number, title }) => ({ number, title }));
    return (await deps.bookmark_view(asker.incognito)).rows;
  };

  return {
    // Runs a row key on the tab ids the page captured at the key press. Undefined for a sender that is not an opener, for a bad argument and when
    // any id names a tab of the other privacy: nothing runs then. An id with no tab is skipped, also one that closes while the action runs.
    // `reopen` also needs `cookie_store_id`, a container the browser lists or the default store. A private line, a tab id of the other privacy and an unknown store give nothing.
    // It leaves out the line's own tab, because closing it ends the line, and tabs already in the container. The answer names what moved and what was skipped when some tabs stayed.
    tab_rows_action: async (action: unknown, tab_ids: unknown, asker: Asker | undefined, cookie_store_id?: unknown): Promise<TabRowsActionAnswer | undefined> => {
      if (!is_tab_rows_action(action) || !Array.isArray(tab_ids) || tab_ids.length > MAX_ACTION_TABS || !tab_ids.every(Number.isInteger) || !asker || !(await deps.is_opener(asker.tab_id, asker.frame_id))) return undefined;
      const unique_ids = [...new Set(tab_ids as number[])];
      const found = await Promise.all(unique_ids.map(async (id) => ({ id, tab: await deps.read_tab(id) })));
      // The reads take time: the line may have lost its ticket meanwhile.
      if (found.some(({ tab }) => tab && tab.incognito !== asker.incognito) || !(await deps.is_opener(asker.tab_id, asker.frame_id))) return undefined;
      const ids = found.filter(({ tab }) => tab).map(({ id }) => id);
      if (action === "reopen") {
        if (asker.incognito || typeof cookie_store_id !== "string" || !(cookie_store_id === DEFAULT_COOKIE_STORE_ID || (await deps.containers()).has(cookie_store_id))) return undefined;
        if (!(await deps.is_opener(asker.tab_id, asker.frame_id))) return undefined;
        const movable = found.flatMap(({ id, tab }) =>
          tab && id !== asker.tab_id && tab.windowId !== undefined ? [{ id, window_id: tab.windowId, index: tab.index, pinned: tab.pinned === true, url: tab.url, cookie_store_id: tab.cookieStoreId }] : [],
        );
        const reopened = await reopen_tabs_in_container(deps.tab_actions, movable, cookie_store_id);
        const left_out = ids.includes(asker.tab_id) ? 1 : 0;
        const already_there = movable.filter((tab) => tab.cookie_store_id === cookie_store_id).length;
        const failed = ids.length - reopened.length - left_out - already_there;
        const skipped = [already_there > 0 ? `${already_there} already there` : "", left_out > 0 ? "line tab left out" : "", failed > 0 ? `${failed} failed` : ""].filter(Boolean);
        return skipped.length === 0 ? {} : { refusal: [`reopened ${reopened.length}`, ...skipped].join(", ") };
      }
      try {
        if (action === "close") await close_tabs(deps.tab_actions, ids);
        else if (action === "mute" || action === "unmute") await set_muted(deps.tab_actions, ids, action === "mute");
        else if (action === "pin" || action === "unpin") await set_pinned(deps.tab_actions, ids, action === "pin");
        else {
          const result = await set_unloaded(deps.discard, ids, action === "unload");
          return result.skipped.length > 0 ? { refusal: describe_result(action === "unload" ? "unloaded" : "loaded", result) } : {};
        }
      } catch {
        return { refusal: "a tab changed before the action ran" };
      }
      return {};
    },
    // Undefined for a sender that is not a tab, for a tab that opened no line and for a tab that closed or navigated
    // while the lookup ran. A failed browser call gives an empty list.
    answer: async (kind: unknown, asker: Asker | undefined): Promise<CompleteItemsAnswer | undefined> => {
      if ((kind !== "bookmarks" && kind !== "engines" && kind !== "history" && kind !== "open" && kind !== "windows" && kind !== "sessions" && kind !== "registers" && kind !== "folders" && kind !== "marks" && kind !== "quickmarks" && kind !== "saved_quickmarks" && kind !== "quality_levels" && kind !== "anything") || !asker || !(await deps.is_opener(asker.tab_id, asker.frame_id))) return undefined;
      const items = await fetch_items(kind, asker).catch(() => (kind === "open" ? { rows: [], history_max: 0, sites: [] } : kind === "history" ? { rows: [], max: 0 } : kind === "bookmarks" ? { rows: [], folders: [] } : kind === "anything" ? { tab_used: {}, tab_boost: {}, sites: [], quickmarks: [], bookmarks: [], history: [], closed: [], history_max: 0 } : []));
      return (await deps.is_opener(asker.tab_id, asker.frame_id)) ? { items } : undefined;
    },
  };
}
