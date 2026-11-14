// The rows of the lists under the clock. The readers are the ones behind the tab and bookmark completion, run on the page itself: no background message, so there is no ticket gate to pass. The page must keep private tabs out on its own.
import { is_web_url, type NewTabLink, type Settings } from "../shared/config.ts";
import { bookmark_items, type ClosedSession, flatten_bookmarks, listed_tabs, type BookmarkNode, type TabLike } from "../background/complete_items.ts";
import { refused_as } from "../shared/swallow.ts";
import { make_favicon_cache, site_host } from "./icon_cache.ts";
import { closed_rows, TOP_SITE_DAYS, top_site_rows, type Visit } from "./widgets.ts";

// `icon_url` is a data: URL from the favicon cache, set only when the cache holds the site. Without it the card shows a letter tile. The page never takes an icon from a tab, so it loads no remote image.
export type ListRow = { label: string; url: string; host: string; icon_url?: string; tab?: { id: number; window_id: number }; session_id?: string };

export type CachedIcons = ReadonlyMap<string, string>;

const icon_field = (icon_url: string | undefined): { icon_url?: string } => (icon_url ? { icon_url } : {});
export type ListSection = { title: string; rows: ListRow[] };

export type ListSettings = Pick<Settings, "newtab_bookmarks" | "newtab_bookmarks_max" | "newtab_recent_tabs" | "newtab_recent_tabs_max" | "newtab_closed_tabs" | "newtab_closed_tabs_max" | "newtab_top_sites" | "newtab_top_sites_max" | "newtab_links">;

export type TabWithUse = TabLike & { lastAccessed?: number | undefined };

// A list is off unless its flag is true. A max of 0 shows no rows.
const row_cap = (shown: boolean, max: number) => (shown ? max : 0);

// Open web tabs, last used first. A private tab never shows, and nothing shows on a private page, so a private window does not list the tabs of a normal one.
// The icon is the cache's for the tab's site, never the tab's own favIconUrl, which is usually a remote address.
export function recent_tab_rows(tabs: readonly TabWithUse[], max: number, page_is_private: boolean, cached: CachedIcons = new Map()): ListRow[] {
  if (page_is_private || max <= 0) return [];
  const last_used = new Map(tabs.map((tab) => [tab.id, tab.lastAccessed ?? 0]));
  return listed_tabs(tabs, { window_id: -1, incognito: false })
    .filter((tab) => is_web_url(tab.url))
    .sort((a, b) => (last_used.get(b.id) ?? 0) - (last_used.get(a.id) ?? 0))
    .slice(0, max)
    .map((tab) => {
      const host = site_host(tab.url);
      return { label: tab.title, url: tab.url, host, ...icon_field(cached.get(host)), tab: { id: tab.id, window_id: tab.window_id } };
    });
}

const card_row = (label: string, url: string, cached: CachedIcons): ListRow => {
  const host = site_host(url);
  return { label, url, host, ...icon_field(cached.get(host)) };
};

// Newest added first, with no folder, separator or repeated address. A non-web address (a javascript: bookmarklet, say) is not a page to open from here.
export function bookmark_rows(roots: readonly BookmarkNode[], max: number, cached: CachedIcons = new Map()): ListRow[] {
  if (max <= 0) return [];
  return bookmark_items(flatten_bookmarks(roots))
    .filter((item) => is_web_url(item.url))
    .slice(0, max)
    .map((item) => card_row(item.title, item.url, cached));
}

// One list per group, in the order each group first appears. Links with no group share one list with no title, placed where the first of them appears.
export function link_sections(links: readonly NewTabLink[], cached: CachedIcons = new Map()): ListSection[] {
  const by_title = new Map<string, ListRow[]>();
  for (const link of links) {
    const rows = by_title.get(link.group ?? "") ?? [];
    rows.push(card_row(link.label, link.url, cached));
    by_title.set(link.group ?? "", rows);
  }
  return [...by_title].map(([title, rows]) => ({ title, rows }));
}

export type PageReaders = {
  query_tabs: () => Promise<TabWithUse[]>;
  bookmark_tree: () => Promise<BookmarkNode[]>;
  page_is_private: () => Promise<boolean>;
  closed_sessions: () => Promise<ClosedSession[]>;
  visits: () => Promise<Visit[]>;
  cached_icons: () => Promise<CachedIcons>;
};

// A reader that fails (a permission, a browser without the API) leaves its list out, so the clock still draws.
export async function read_sections(settings: ListSettings, readers: PageReaders): Promise<ListSection[]> {
  const cached = await refused_as(readers.cached_icons(), new Map<string, string>());
  const sections: ListSection[] = link_sections(settings.newtab_links, cached);
  const tab_cap = row_cap(settings.newtab_recent_tabs, settings.newtab_recent_tabs_max);
  const bookmark_cap = row_cap(settings.newtab_bookmarks, settings.newtab_bookmarks_max);
  const closed_cap = row_cap(settings.newtab_closed_tabs, settings.newtab_closed_tabs_max);
  const top_cap = row_cap(settings.newtab_top_sites, settings.newtab_top_sites_max);
  const [tabs, bookmarks, closed, top] = await Promise.all([
    tab_cap > 0 ? refused_as(Promise.all([readers.query_tabs(), readers.page_is_private()]).then(([found, is_private]) => recent_tab_rows(found, tab_cap, is_private, cached)), []) : [],
    bookmark_cap > 0 ? refused_as(readers.bookmark_tree().then((roots) => bookmark_rows(roots, bookmark_cap, cached)), []) : [],
    closed_cap > 0 ? refused_as(Promise.all([readers.closed_sessions(), readers.page_is_private()]).then(([found, is_private]) => closed_rows(found, closed_cap, is_private, cached)), []) : [],
    top_cap > 0 ? refused_as(Promise.all([readers.visits(), readers.page_is_private()]).then(([found, is_private]) => top_site_rows(found, top_cap, is_private, cached)), []) : [],
  ]);
  if (tabs.length > 0) sections.push({ title: "Recent tabs", rows: tabs });
  if (closed.length > 0) sections.push({ title: "Recently closed", rows: closed });
  if (top.length > 0) sections.push({ title: "Top sites", rows: top });
  if (bookmarks.length > 0) sections.push({ title: "Bookmarks", rows: bookmarks });
  return sections;
}

export const browser_page_readers: PageReaders = {
  query_tabs: () => browser.tabs.query({}),
  bookmark_tree: () => browser.bookmarks.getTree(),
  page_is_private: async () => (await browser.windows.getCurrent()).incognito,
  closed_sessions: () => browser.sessions.getRecentlyClosed(),
  visits: () => browser.history.search({ text: "", startTime: Date.now() - TOP_SITE_DAYS * 86_400_000, maxResults: 5000 }),
  cached_icons: () => make_favicon_cache(browser.storage.local).read(),
};
