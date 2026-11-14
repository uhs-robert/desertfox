// The rows of the local widgets: recently closed tabs and the most visited sites. Both read the browser on the page itself, so nothing leaves the machine and no permission beyond `sessions` and `history` is needed.
import { closed_tab_rows, type ClosedSession } from "../background/complete_items.ts";
import { is_web_url } from "../shared/config.ts";
import { icon_field, site_host } from "./icon_cache.ts";
import type { CachedIcons, ListRow } from "./lists.ts";

// Newest closed first, as `getRecentlyClosed` gives them. A click restores the session, so the tab comes back with its history.
export function closed_rows(sessions: readonly ClosedSession[], max: number, page_is_private: boolean, cached: CachedIcons = new Map()): ListRow[] {
  if (page_is_private || max <= 0) return [];
  return closed_tab_rows(sessions, false)
    .filter((row) => is_web_url(row.url))
    .slice(0, max)
    .map((row) => {
      const host = site_host(row.url);
      return { label: row.title, url: row.url, host, ...icon_field(cached.get(host)), session_id: row.session_id };
    });
}

export const TOP_SITE_DAYS = 90;

export type Visit = { url?: string | undefined; title?: string | undefined; visitCount?: number | undefined };

// One row per host, most visits first. The card opens the host's own most visited page, so a search results page never stands for the site. History answers with visit totals per address, which is the best count `history.search` gives.
export function top_site_rows(visits: readonly Visit[], max: number, page_is_private: boolean, cached: CachedIcons = new Map()): ListRow[] {
  if (page_is_private || max <= 0) return [];
  const by_host = new Map<string, { total: number; best_count: number; url: string; title: string }>();
  for (const { url, title, visitCount } of visits) {
    if (!url || !is_web_url(url)) continue;
    const host = site_host(url);
    if (!host) continue;
    const count = visitCount ?? 0;
    const seen = by_host.get(host);
    if (!seen) by_host.set(host, { total: count, best_count: count, url, title: title || host });
    else {
      seen.total += count;
      if (count > seen.best_count) Object.assign(seen, { best_count: count, url, title: title || host });
    }
  }
  return [...by_host]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, max)
    .map(([host, site]) => ({ label: site.title, url: site.url, host, ...icon_field(cached.get(host)) }));
}
