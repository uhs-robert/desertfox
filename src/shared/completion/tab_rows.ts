// The rows of the tab, bookmark and closed-tab lists, built from browser data with no browser call. The command line's lists (`background/complete_items.ts`) and the new tab page (`newtab/lists.ts`) read them. The new tab page filters private tabs through `listed_tabs`.

import type { BookmarkItem, ClosedTabRow, TabContainer, TabItem } from "../messages/content.ts";

export const one_line = (text: string) => text.replace(/\s+/g, " ").trim();

// A visit to these is no page the user would open from the line.
export const SKIPPED_SCHEMES = /^(about|moz-extension|data):/i;

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

// Firefox hands loaded, restored and discarded tab favicons over as data: URLs (measured on six sites in Firefox 160), and a busy site's runs to about 24 KB (reddit, 23682 characters). The tab model port carries each row's favicon in every snapshot and patch, so 100 such tabs send about 2.4 MB per command line open. A longer favicon falls back to the plain glyph.
const MAX_DATA_FAVICON = 32768;

// Only data: favicons pass: the extension CSP blocks remote images, and a chrome: favicon would fail to load in the page anyway.
export function listed_favicon(url: string | undefined): string | undefined {
  return url && /^data:image\//i.test(url) && url.length <= MAX_DATA_FAVICON ? url : undefined;
}

// A tab the line can list. The page gets `TabItem` only.
export type ListedTab = TabItem & { window_id: number };

// The window and privacy of the tab that holds the line.
export type LineScope = { window_id: number; incognito: boolean };

export type BookmarkNode = { id?: string | undefined; unmodifiable?: string | undefined; type?: string | undefined; title?: string | undefined; url?: string | undefined; dateAdded?: number | undefined; children?: BookmarkNode[] | undefined };

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

// A tab of a closed-tab session with an address worth opening again. Newest first, as `getRecentlyClosed` gives them. Windows, private tabs (which `getRecentlyClosed` returns while their window is open) and tabs with no session id drop out.
export type ClosedSession = { tab?: { sessionId?: string | undefined; title?: string | undefined; url?: string | undefined; incognito?: boolean | undefined } | undefined };

export function closed_tab_rows(sessions: readonly ClosedSession[]): ClosedTabRow[] {
  return sessions.flatMap(({ tab }) => (tab?.sessionId && tab.url && !tab.incognito && !SKIPPED_SCHEMES.test(tab.url) ? [{ session_id: tab.sessionId, title: one_line(tab.title || tab.url), url: tab.url }] : []));
}
