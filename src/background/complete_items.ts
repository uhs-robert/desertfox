// The tabs, bookmarks, engines and windows the command line page lists for `tab`, `bookmark`, `search` and `tab.attach`. That page cannot read them itself: only the
// background knows which tab asked, so only it can keep private tabs out of a normal line and refuse a page that never opened a line.
// The pure readers here (`listed_tabs`, `flatten_bookmarks`, `bookmark_items`) are also imported by the new tab page, which reads its own lists and filters private tabs itself (`newtab/lists.ts`).

import type { SearchEngine } from "../shared/config.ts";
import type { PageInfo } from "../shared/engines/index.ts";
import type { BookmarkItem, CompleteItemsAnswer, EngineItem, HistoryItem, OpenRow, TabContainer, TabItem, TabRowsAction, TabRowsActionAnswer, WindowItem } from "../shared/messages.ts";
import { available_engine_names } from "./availability.ts";
import { DEFAULT_COOKIE_STORE_ID } from "../shared/container_store.ts";
import { close_tabs, reopen_tabs_in_container, set_muted, set_pinned } from "./tab_actions.ts";
import type { TabActionDeps } from "./tab_actions.ts";
import { describe_result, set_unloaded } from "./tab_discard.ts";
import type { DiscardDeps } from "./tab_discard.ts";

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

export type BookmarkNode = { type?: string | undefined; title?: string | undefined; url?: string | undefined; dateAdded?: number | undefined; children?: BookmarkNode[] | undefined };

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

// Newest first, as `flatten_bookmarks` gives them. Folders, separators and a repeated address drop out.
export function bookmark_items(nodes: readonly BookmarkNode[]): BookmarkItem[] {
  const seen = new Set<string>();
  const items: BookmarkItem[] = [];
  for (const node of nodes) {
    if ((node.type !== undefined && node.type !== "bookmark") || !node.url || seen.has(node.url)) continue;
    seen.add(node.url);
    items.push({ title: one_line(node.title || node.url), url: node.url });
  }
  return items;
}

// A visit to these is no page the user would open from the line.
const SKIPPED_SCHEMES = /^(about|moz-extension|data):/i;

export type HistoryNode = { title?: string | undefined; url?: string | undefined };

// Newest first, as `history.search` gives them. Skipped schemes drop out.
export function history_items(nodes: readonly HistoryNode[]): HistoryItem[] {
  return nodes
    .filter((node): node is HistoryNode & { url: string } => !!node.url && !SKIPPED_SCHEMES.test(node.url))
    .map((node) => ({ title: one_line(node.title || node.url), url: node.url }));
}

export type OpenSource = "bookmarks" | "history";

export type OpenSettings = { sources: readonly OpenSource[]; history_max: number };

// Rows in the order of `sources`. A history row whose address is a bookmark drops out, so the address shows once, as the bookmark.
export function open_rows(sources: readonly OpenSource[], bookmarks: readonly BookmarkItem[], history: readonly HistoryItem[]): OpenRow[] {
  const bookmarked = new Set(bookmarks.map((bookmark) => bookmark.url));
  const groups: Record<OpenSource, OpenRow[]> = {
    bookmarks: bookmarks.map((bookmark) => ({ ...bookmark, tag: "bm" })),
    history: history.filter((item) => !bookmarked.has(item.url)).map((item) => ({ ...item, tag: "hist" })),
  };
  return sources.flatMap((source) => groups[source]);
}

// Every engine in config order. The flag says whether the page can fill it, so the list can mark the rest. The page URL is read here and goes no further.
export function engine_items(engines: Record<string, SearchEngine>, page: PageInfo | undefined): EngineItem[] {
  const available = new Set(available_engine_names(engines, page));
  return Object.entries(engines).map(([name, engine]) => ({ name, label: engine.label, available: available.has(name) }));
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

export const browser_complete_items_deps = {
  query_tabs: ((window_id) => browser.tabs.query(window_id === undefined ? {} : { windowId: window_id })) as TabQuery,
  query_windows: (async () => browser.windows.getAll({ populate: true })) as () => Promise<WindowLike[]>,
  all_bookmarks: async (): Promise<BookmarkNode[]> => flatten_bookmarks(await browser.bookmarks.getTree()),
  // `startTime: 0` reaches all history, since the default is the last day. The page ranks, so it needs more than it shows.
  search_history: async (): Promise<HistoryNode[]> => browser.history.search({ text: "", startTime: 0, maxResults: 1000 }),
  containers: (): Promise<ContainerMarks> => read_containers(() => browser.contextualIdentities.query({})),
};

export type CompleteItemsDeps = typeof browser_complete_items_deps & {
  // Whether the frame of the tab redeemed a ticket, and the tab has not closed or navigated since.
  is_opener: (tab_id: number, frame_id: number) => Promise<boolean>;
  // The tab the line's window was on before its current one.
  previous_tab: (window_id: number) => Promise<number | undefined>;
  search_engines: () => Promise<Record<string, SearchEngine>>;
  // The page of the line's tab, undefined when it has none.
  page_of: (tab_id: number) => Promise<PageInfo | undefined>;
  open_settings: () => Promise<OpenSettings>;
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
    const history = sources.includes("history") && !asker.incognito ? history_items(await deps.search_history().catch(() => [])) : [];
    return { rows: open_rows(sources, bookmarks, history), history_max };
  };

  const fetch_items = async (kind: "bookmarks" | "engines" | "open" | "windows", asker: Asker): Promise<CompleteItemsAnswer["items"]> => {
    // The set is read once per line. The line is modal over one tab, so the page cannot change under it.
    if (kind === "engines") return engine_items(await deps.search_engines(), await deps.page_of(asker.tab_id));
    if (kind === "open") return open_items(asker);
    if (kind === "windows") return listed_windows(await deps.query_windows(), asker).map(({ number, title }) => ({ number, title }));
    return bookmark_items(await deps.all_bookmarks());
  };

  return {
    // Runs a row key on the tab ids the page captured at the key press. Undefined for a sender that is not an opener, for a bad argument and when
    // any id names a tab of the other privacy: nothing runs then. An id with no tab is skipped, also one that closes while the action runs.
    // `reopen` also needs `cookie_store_id`, a container the browser lists or the default store. A private line, a tab id of the other privacy and an unknown store give nothing.
    // It leaves out the line's own tab, because closing it ends the line, and tabs already in the container. The answer counts the tabs that moved when some stayed.
    tab_rows_action: async (action: unknown, tab_ids: unknown, asker: Asker | undefined, cookie_store_id?: unknown): Promise<TabRowsActionAnswer | undefined> => {
      if (!is_tab_rows_action(action) || !Array.isArray(tab_ids) || tab_ids.length > MAX_ACTION_TABS || !tab_ids.every(Number.isInteger) || !asker || !(await deps.is_opener(asker.tab_id, asker.frame_id))) return undefined;
      const unique_ids = [...new Set(tab_ids as number[])];
      const found = await Promise.all(unique_ids.map(async (id) => ({ id, tab: await deps.read_tab(id) })));
      // The reads take time: the line may have lost its ticket meanwhile.
      if (found.some(({ tab }) => tab && tab.incognito !== asker.incognito) || !(await deps.is_opener(asker.tab_id, asker.frame_id))) return undefined;
      const ids = found.filter(({ tab }) => tab).map(({ id }) => id);
      if (action === "reopen") {
        if (asker.incognito || typeof cookie_store_id !== "string" || !(cookie_store_id === DEFAULT_COOKIE_STORE_ID || (await deps.containers()).has(cookie_store_id))) return undefined;
        const movable = found.flatMap(({ id, tab }) =>
          tab && id !== asker.tab_id && tab.windowId !== undefined ? [{ id, window_id: tab.windowId, index: tab.index, pinned: tab.pinned === true, url: tab.url, cookie_store_id: tab.cookieStoreId }] : [],
        );
        const reopened = await reopen_tabs_in_container(deps.tab_actions, movable, cookie_store_id);
        return reopened.length === ids.length ? {} : { refusal: `reopened ${reopened.length} of ${ids.length} tabs` };
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
      if ((kind !== "bookmarks" && kind !== "engines" && kind !== "open" && kind !== "windows") || !asker || !(await deps.is_opener(asker.tab_id, asker.frame_id))) return undefined;
      const items = await fetch_items(kind, asker).catch(() => (kind === "open" ? { rows: [], history_max: 0 } : []));
      return (await deps.is_opener(asker.tab_id, asker.frame_id)) ? { items } : undefined;
    },
  };
}
