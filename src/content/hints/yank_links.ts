// The links of the page for `copy.links`: which links count, their label, and the list in one of three formats.

import { collect, query_for } from "./candidates.ts";
import type { Found } from "./candidates.ts";
import { rendered_text } from "./headings.ts";

export const LINK_FORMATS = ["markdown", "plain", "org"] as const;
export type LinkFormat = (typeof LINK_FORMATS)[number];

export const MAX_YANKED_LINKS = 500;

const WEB_PROTOCOLS = new Set(["http:", "https:", "ftp:", "file:"]);

export type YankedLink = { url: string; text: string };

// Mailto, tel, javascript and data links are no web address, and a link that stays on its own page by a fragment is no destination.
export function web_address(raw: string, base: string, page_url: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return undefined;
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) return undefined;
  const without_fragment = (address: string) => address.split("#")[0];
  if (url.hash !== "" && without_fragment(url.href) === without_fragment(page_url)) return undefined;
  return url.href;
}

// The text a person sees, else the names assistive tools use, else the address.
export function label_of(element: Element, address: string): string {
  const image_alt = element.querySelector("img[alt]")?.getAttribute("alt") ?? "";
  const candidates = [rendered_text(element), element.getAttribute("aria-label") ?? "", element.getAttribute("title") ?? "", image_alt];
  const one_line = (text: string) => text.replace(/\s+/g, " ").trim();
  return candidates.map(one_line).find((text) => text !== "") ?? address;
}

// The first link to an address wins. The list stops at the cap.
export function links_of(found: readonly Found[], page_url: string): YankedLink[] {
  const seen = new Set<string>();
  const links: YankedLink[] = [];
  for (const { element } of found) {
    const url = web_address(element.getAttribute("href") ?? "", element.baseURI, page_url);
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: label_of(element, url) });
    if (links.length === MAX_YANKED_LINKS) break;
  }
  return links;
}

export function format_links(links: readonly YankedLink[], format: LinkFormat): string {
  return links
    .map(({ url, text }) => {
      switch (format) {
        case "plain":
          return url;
        case "markdown":
          return `- [${link_text(text)}](${url.replace(/\)/g, "%29")})`;
        case "org":
          return `- [[${url.replace(/]/g, "%5D")}][${link_text(text)}]]`;
      }
    })
    .join("\n");
}

// Square brackets in the text would end the link text early. The page copy in `handlers/copy.ts` does the same, but importing it would pull the toast proxy into this bundle.
const link_text = (text: string) => text.replace(/\[/g, "(").replace(/\]/g, ")");

export const all_links = (): Found[] => collect(document, query_for("links", undefined));
