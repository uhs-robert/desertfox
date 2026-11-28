// The lines of a copied link list, shared by the page links (`content/hints/yank_links.ts`) and the open tabs (`commands/copy_tabs.ts`), so both read alike.
// Pure and DOM-free, so the background can use it too.

import { link_text, markdown_address, org_address } from "./link_escape.ts";
import { strip_tracking } from "./strip_tracking.ts";

// Mailto, tel, javascript and data addresses are no web address.
export const is_web_address = (url: string): boolean => /^(https?|ftp|file):/i.test(url);

export type ListedLink = { url: string; text: string };

export const MAX_YANKED_LINKS = 500;

// The first link to an address wins, after the tracking parameters are dropped, so links that differ only by them make one entry. The list stops at the cap. `url_of` gives a candidate's address or nothing to skip it, and `label` gets the address after stripping, the fallback of a link with no text, and runs only for a link that is kept.
export function dedupe_links<T>(candidates: readonly T[], url_of: (candidate: T) => string | undefined, strip_patterns: readonly string[], label: (candidate: T, stripped_url: string) => string): ListedLink[] {
  const seen = new Set<string>();
  const links: ListedLink[] = [];
  for (const candidate of candidates) {
    const url = strip_tracking(url_of(candidate) ?? "", strip_patterns);
    if (url === "" || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: label(candidate, url) });
    if (links.length === MAX_YANKED_LINKS) break;
  }
  return links;
}

export const LIST_FORMATS = ["markdown", "plain", "org", "title"] as const;
export type ListFormat = (typeof LIST_FORMATS)[number];

export function format_link_list(links: readonly ListedLink[], format: ListFormat): string {
  return links
    .map(({ url, text }) => {
      switch (format) {
        case "plain":
          return url;
        case "title":
          return text;
        case "markdown":
          return `- [${link_text(text)}](${markdown_address(url)})`;
        case "org":
          return `- [[${org_address(url)}][${link_text(text)}]]`;
      }
    })
    .join("\n");
}
