// The links of the page for `copy.links`: which links count, their label, and the list in one of three formats.

import { dedupe_links, format_link_list, is_web_address } from "../../shared/copy/link_list.ts";
import type { Outcome } from "../../shared/messages/content.ts";
import type { Yanked } from "../../shared/copy/copy_text.ts";
import { collect, name_candidates, query_for } from "../lib/candidates.ts";
import type { Found } from "../lib/candidates.ts";
import { rendered_text } from "../lib/heading_match.ts";

export const LINK_FORMATS = ["markdown", "plain", "org"] as const;
export type LinkFormat = (typeof LINK_FORMATS)[number];

export type YankedLink = { url: string; text: string };

// Mailto, tel, javascript and data links are no web address, and a link that stays on its own page by a fragment is no destination. A bare `#` is a fragment too, though its `hash` is empty.
export function web_address(raw: string, base: string, document_url: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return undefined;
  }
  if (!is_web_address(url.href)) return undefined;
  const without_fragment = (address: string) => address.split("#")[0];
  if (url.href.includes("#") && without_fragment(url.href) === without_fragment(document_url)) return undefined;
  return url.href;
}

// The text a person sees, else the names assistive tools use, else the address.
export const label_of = (element: Element, address: string): string => name_candidates(element, rendered_text(element))[0] ?? address;

export const links_of = (found: readonly Found[], strip_patterns: readonly string[] = []): YankedLink[] =>
  dedupe_links(found, ({ element }) => web_address(element.getAttribute("href") ?? "", element.baseURI, element.ownerDocument.URL), strip_patterns, ({ element }, url) => label_of(element, url));

export const format_links: (links: readonly YankedLink[], format: LinkFormat) => string = format_link_list;

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
  const copied = await deps.copy(format_link_list(links, format));
  if (!copied.ok) return copied;
  if (!("dropped" in copied)) deps.show_message_(`Copied ${links.length} ${links.length === 1 ? "link" : "links"}`);
  return { ok: true };
}
