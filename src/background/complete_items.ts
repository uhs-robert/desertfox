// The tabs and bookmarks the command line page lists for `tab` and `bookmark`. The page cannot read them itself: only the
// background knows which tab asked, so only it can keep private tabs out of a normal line and refuse a page that never opened a line.

import type { BookmarkItem, CompleteItemsAnswer, TabItem } from "../shared/messages.ts";

export type TabLike = { id?: number | undefined; index: number; windowId?: number | undefined; title?: string | undefined; url?: string | undefined; incognito: boolean };

// A tab the line can list. The page gets `TabItem` only.
export type ListedTab = TabItem & { id: number; window_id: number };

// The window and privacy of the tab that holds the line.
export type LineScope = { window_id: number; incognito: boolean };

export type BookmarkNode = { type?: string | undefined; title?: string | undefined; url?: string | undefined };

// getRecent needs a count. No person keeps more bookmarks than this.
const MOST_BOOKMARKS = 10_000;

const one_line = (text: string) => text.replace(/\s+/g, " ").trim();

// A normal line lists only normal tabs and a private line only private tabs. The line's own window comes first, so
// that is where a number lands when several windows are listed.
export function listed_tabs(tabs: readonly TabLike[], scope: LineScope): ListedTab[] {
  return tabs
    .filter((tab) => tab.id !== undefined && tab.windowId !== undefined && tab.incognito === scope.incognito)
    .map((tab): ListedTab => ({ id: tab.id as number, window_id: tab.windowId as number, number: tab.index + 1, title: one_line(tab.title || tab.url || ""), url: tab.url ?? "" }))
    .sort((a, b) => Number(b.window_id === scope.window_id) - Number(a.window_id === scope.window_id) || a.window_id - b.window_id || a.number - b.number);
}

// Newest first as getRecent gives them. Folders, separators and a repeated address drop out.
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

export type TabQuery = (window_id: number | undefined) => Promise<TabLike[]>;

export const read_tabs = async (query: TabQuery, scope: LineScope, all_windows: boolean): Promise<ListedTab[]> =>
  listed_tabs(await query(all_windows ? undefined : scope.window_id), scope);

export const browser_complete_items_deps = {
  query_tabs: ((window_id) => browser.tabs.query(window_id === undefined ? {} : { windowId: window_id })) as TabQuery,
  recent_bookmarks: async (): Promise<BookmarkNode[]> => browser.bookmarks.getRecent(MOST_BOOKMARKS),
};

export type CompleteItemsDeps = typeof browser_complete_items_deps & {
  // Whether the tab redeemed a ticket and has not closed or navigated since.
  is_opener: (tab_id: number) => Promise<boolean>;
  all_windows: () => Promise<boolean>;
};

export type Asker = LineScope & { tab_id: number };

export function create_complete_items(deps: CompleteItemsDeps) {
  const fetch_items = async (kind: "tabs" | "bookmarks", asker: Asker): Promise<CompleteItemsAnswer["items"]> => {
    if (kind === "bookmarks") return bookmark_items(await deps.recent_bookmarks());
    return (await read_tabs(deps.query_tabs, asker, await deps.all_windows())).map(({ number, title, url }) => ({ number, title, url }));
  };

  return {
    // Undefined for a sender that is not a tab, for a tab that opened no line and for a tab that closed or navigated
    // while the lookup ran. A failed browser call gives an empty list.
    answer: async (kind: unknown, asker: Asker | undefined): Promise<CompleteItemsAnswer | undefined> => {
      if ((kind !== "tabs" && kind !== "bookmarks") || !asker || !(await deps.is_opener(asker.tab_id))) return undefined;
      const items = await fetch_items(kind, asker).catch(() => []);
      return (await deps.is_opener(asker.tab_id)) ? { items } : undefined;
    },
  };
}
