// The rows of the lists under the clock. The readers are the ones behind the tab and bookmark completion, run on the page itself: no background message, so there is no ticket gate to pass. The page must keep private tabs out on its own.
import { is_web_url, type NewTabLink, type Settings } from "../shared/config.ts";
import { bookmark_items, flatten_bookmarks, listed_tabs, type BookmarkNode, type TabLike } from "../background/complete_items.ts";

export const DEFAULT_ROWS = 8;

export type ListRow = { label: string; url: string; tab?: { id: number; window_id: number } };
export type ListSection = { title: string; rows: ListRow[] };

export type ListSettings = Pick<Settings, "newtab_bookmarks" | "newtab_bookmarks_max" | "newtab_recent_tabs" | "newtab_recent_tabs_max" | "newtab_links">;

export type TabWithUse = TabLike & { lastAccessed?: number | undefined };

// A list is off unless its flag is true. A max of 0 shows no rows.
const row_cap = (flag: boolean | undefined, max: number | undefined) => (flag === true ? (max ?? DEFAULT_ROWS) : 0);

// Open web tabs, last used first. A private tab never shows, and nothing shows on a private page, so a private window does not list the tabs of a normal one.
export function recent_tab_rows(tabs: readonly TabWithUse[], max: number, page_is_private: boolean): ListRow[] {
  if (page_is_private || max <= 0) return [];
  const last_used = new Map(tabs.map((tab) => [tab.id, tab.lastAccessed ?? 0]));
  return listed_tabs(tabs, { window_id: -1, incognito: false })
    .filter((tab) => is_web_url(tab.url))
    .sort((a, b) => (last_used.get(b.id) ?? 0) - (last_used.get(a.id) ?? 0))
    .slice(0, max)
    .map((tab) => ({ label: tab.title, url: tab.url, tab: { id: tab.id, window_id: tab.window_id } }));
}

// Newest added first, with no folder, separator or repeated address. A non-web address (a javascript: bookmarklet, say) is not a page to open from here.
export function bookmark_rows(roots: readonly BookmarkNode[], max: number): ListRow[] {
  if (max <= 0) return [];
  return bookmark_items(flatten_bookmarks(roots))
    .filter((item) => is_web_url(item.url))
    .slice(0, max)
    .map((item) => ({ label: item.title, url: item.url }));
}

// One list per group in first-seen order. Links with no group share the first list, which has no title.
export function link_sections(links: readonly NewTabLink[]): ListSection[] {
  const by_title = new Map<string, ListRow[]>();
  for (const link of links) {
    const rows = by_title.get(link.group ?? "") ?? [];
    rows.push({ label: link.label, url: link.url });
    by_title.set(link.group ?? "", rows);
  }
  return [...by_title].map(([title, rows]) => ({ title, rows }));
}

export type PageReaders = {
  query_tabs: () => Promise<TabWithUse[]>;
  bookmark_tree: () => Promise<BookmarkNode[]>;
  page_is_private: () => Promise<boolean>;
};

// A reader that fails (a permission, a browser without the API) leaves its list out, so the clock still draws.
export async function read_sections(settings: ListSettings, readers: PageReaders): Promise<ListSection[]> {
  const sections: ListSection[] = link_sections(settings.newtab_links ?? []);
  const tab_cap = row_cap(settings.newtab_recent_tabs, settings.newtab_recent_tabs_max);
  const bookmark_cap = row_cap(settings.newtab_bookmarks, settings.newtab_bookmarks_max);
  const [tabs, bookmarks] = await Promise.all([
    tab_cap > 0 ? Promise.all([readers.query_tabs(), readers.page_is_private()]).then(([found, is_private]) => recent_tab_rows(found, tab_cap, is_private)).catch(() => []) : [],
    bookmark_cap > 0 ? readers.bookmark_tree().then((roots) => bookmark_rows(roots, bookmark_cap)).catch(() => []) : [],
  ]);
  if (tabs.length > 0) sections.push({ title: "Recent tabs", rows: tabs });
  if (bookmarks.length > 0) sections.push({ title: "Bookmarks", rows: bookmarks });
  return sections;
}

export const browser_page_readers: PageReaders = {
  query_tabs: () => browser.tabs.query({}),
  bookmark_tree: () => browser.bookmarks.getTree(),
  page_is_private: async () => (await browser.windows.getCurrent()).incognito,
};
