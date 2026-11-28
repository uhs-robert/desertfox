// The reply of `page_links.read`: the links of a page the module read where DesertFox's own page code does not run. The reply is foreign input. It is checked here before anything is copied, and the module keeps the same caps (browser_module/desertfox-page-links.js, which a test holds equal).
// The addresses are only formatted, copied and stored. Nothing opens or loads one.

import { MAX_YANKED_LINKS } from "./copy/link_list.ts";

export const PAGE_LINK_SCOPES = ["page", "viewport"] as const;
export type PageLinkScope = (typeof PAGE_LINK_SCOPES)[number];

export const MAX_PAGE_LINKS = MAX_YANKED_LINKS;
// The reply value as JSON text. The kind's own limit is 64 KB for the whole reply, and the value is escaped inside it.
export const MAX_PAGE_LINKS_BYTES = 60_000;
export const MAX_PAGE_LINK_ADDRESS_CHARS = 2048;
export const MAX_PAGE_LINK_TEXT_CHARS = 512;
export const PAGE_LINK_SCHEMES: readonly string[] = ["http:", "https:", "ftp:", "file:"];

export type PageLink = { address: string; text: string };

const ADDRESS_SHAPE = /^[^\s\p{Cc}\p{Cf}]+$/u;

// A cut address is a wrong address, so a long one is dropped. A parse that fails or a scheme off the list drops the entry too.
function checked_address(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > MAX_PAGE_LINK_ADDRESS_CHARS || !ADDRESS_SHAPE.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    return PAGE_LINK_SCHEMES.includes(url.protocol) && url.href.length <= MAX_PAGE_LINK_ADDRESS_CHARS ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// Control and format characters go, whitespace runs become one space, then the cap.
const cleaned_text = (raw: string): string => [...raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_PAGE_LINK_TEXT_CHARS).join("");

// The pairs of the reply value, or undefined when the whole reply is refused: text over the byte cap, not JSON, or not a list. A bad entry is skipped. Only the first MAX_PAGE_LINKS entries are read.
export function parse_page_links(value: string | undefined): PageLink[] | undefined {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > MAX_PAGE_LINKS_BYTES) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const links: PageLink[] = [];
  for (const entry of parsed.slice(0, MAX_PAGE_LINKS)) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[1] !== "string") continue;
    const address = checked_address(entry[0]);
    if (address !== undefined) links.push({ address, text: cleaned_text(entry[1]) });
  }
  return links;
}
