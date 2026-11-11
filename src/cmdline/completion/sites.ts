// The bare-site rows of `open` and the finder: the home page of a visited host, so `git` offers github.com before any one page of it. Pure.

import type { SiteItem } from "../../shared/messages.ts";

const MIN_SITE_WORD = 2;
const MAX_SITE_ROWS = 3;

// `https://github.com/` gives `github.com`.
export const host_of = (site: SiteItem): string => site.url.slice(site.url.indexOf("//") + 2, -1);

// The word must start a label of the host, so `git` finds github.com and not digital.com, and one word only, as a host has no space. The background sends the busiest hosts first, so the cap keeps those.
export function matching_sites(word: string, sites: readonly SiteItem[], listed: (url: string) => boolean): SiteItem[] {
  const typed = word.trim().toLowerCase();
  if (typed.length < MIN_SITE_WORD || /\s/.test(typed)) return [];
  const found: SiteItem[] = [];
  for (const site of sites) {
    if (found.length >= MAX_SITE_ROWS) break;
    if (`.${host_of(site)}`.includes(`.${typed}`) && !listed(site.url)) found.push(site);
  }
  return found;
}
