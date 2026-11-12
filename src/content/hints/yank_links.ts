// The links of the page for `copy.links`: which links count, their label, and the list in one of three formats.

import { strip_tracking } from "../strip_tracking.ts";
import { format_link_list } from "../link_list.ts";
import type { Outcome } from "../../shared/messages.ts";
import type { Yanked } from "../caret/copy_text.ts";
import { collect, name_candidates, query_for } from "./candidates.ts";
import type { Found } from "./candidates.ts";
import { rendered_text } from "./headings.ts";

export const LINK_FORMATS = ["markdown", "plain", "org"] as const;
export type LinkFormat = (typeof LINK_FORMATS)[number];

export const MAX_YANKED_LINKS = 500;

const WEB_PROTOCOLS = new Set(["http:", "https:", "ftp:", "file:"]);

export type YankedLink = { url: string; text: string };

// Mailto, tel, javascript and data links are no web address, and a link that stays on its own page by a fragment is no destination. A bare `#` is a fragment too, though its `hash` is empty.
export function web_address(raw: string, base: string, document_url: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return undefined;
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) return undefined;
  const without_fragment = (address: string) => address.split("#")[0];
  if (url.href.includes("#") && without_fragment(url.href) === without_fragment(document_url)) return undefined;
  return url.href;
}

// The text a person sees, else the names assistive tools use, else the address.
export const label_of = (element: Element, address: string): string => name_candidates(element, rendered_text(element))[0] ?? address;

// The first link to an address wins, after the tracking parameters are dropped, so links that differ only by them make one entry. The list stops at the cap.
export function links_of(found: readonly Found[], strip_patterns: readonly string[] = []): YankedLink[] {
  const seen = new Set<string>();
  const links: YankedLink[] = [];
  for (const { element } of found) {
    const address = web_address(element.getAttribute("href") ?? "", element.baseURI, element.ownerDocument.URL);
    if (address === undefined) continue;
    const url = strip_tracking(address, strip_patterns);
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: label_of(element, url) });
    if (links.length === MAX_YANKED_LINKS) break;
  }
  return links;
}

export const format_links = (links: readonly YankedLink[], format: LinkFormat): string => format_link_list(links, format);

export const all_links = (): Found[] => collect(document, query_for("links", undefined));

export type YankDeps = {
  find: () => Found[];
  strip_patterns: () => Promise<readonly string[]>;
  keep_present_: (found: Found[]) => Found[];
  keep_in_view_: (found: Found[]) => Promise<Found[]>;
  copy: (text: string) => Promise<Yanked>;
  show_message_: (message: string) => void;
};

// The page scope takes every link that is present, the viewport scope only those in view.
export async function yank_links(scope: "page" | "viewport", format: LinkFormat, deps: YankDeps): Promise<Outcome> {
  const found = deps.find();
  const kept = scope === "page" ? deps.keep_present_(found) : await deps.keep_in_view_(found);
  const links = links_of(kept, await deps.strip_patterns());
  if (links.length === 0) return { ok: false, message: "No links on this page" };
  const copied = await deps.copy(format_links(links, format));
  if (!copied.ok) return copied;
  if (!("dropped" in copied)) deps.show_message_(`Copied ${links.length} ${links.length === 1 ? "link" : "links"}`);
  return { ok: true };
}
