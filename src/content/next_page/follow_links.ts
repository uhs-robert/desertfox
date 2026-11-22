// The live page for the detector in `detect.ts`: the `rel` links, the links and buttons, and a `PageReader` over real elements.

import { BUTTONS, collect, LINKS, name_candidates } from "../hints/candidates.ts";
import type { Found } from "../hints/candidates.ts";
import { keep_present_found } from "../hints/headings.ts";
import { has_usable_address } from "../hints/actions.ts";
import { dom_reader, pointer_starts } from "../lib/dom_reader.ts";
import { detect_next_page } from "./detect.ts";
import type { LoadStep, NextPageAction } from "./detect.ts";

export type FollowDirection = "next" | "prev";

const rel_selector = (direction: FollowDirection): string => ["link", "a", "area"].map((tag) => `${tag}[rel~="${direction}"][href]`).join(", ");

// The first `rel` link in document order, across same-origin frames and shadow roots. It needs no box, because a `<link>` in the head has none.
export const find_rel_link = (root: ParentNode, direction: FollowDirection): Found | undefined => collect(root, { selector: rel_selector(direction) })[0];

export const texts_of = (element: Element): string[] => name_candidates(element, (element as HTMLElement).innerText ?? element.textContent);

// The background reads a `javascript:` or `data:` address as typed text and would search for it. A button has no address and is clicked.
export const can_open_elsewhere = (element: HTMLElement): boolean => !("href" in element) || has_usable_address(element, false, true);

// Links and buttons count off screen too: the next link usually sits at the bottom. The page is only searched when it has no rel link.
export function find_next_page(doc: Document, direction: FollowDirection, patterns: readonly string[], load_step?: LoadStep): NextPageAction<Element> {
  const rel = find_rel_link(doc, direction);
  if (rel) return { action: "follow", target: rel.element };
  const links = keep_present_found(collect(doc, { selector: LINKS }));
  const items = [...links, ...keep_present_found(collect(doc, { selector: BUTTONS }))];
  const controls = items.map((item, place) => ({ node: item.element, texts: texts_of(item.element), is_link: place < links.length }));
  return detect_next_page({ ...dom_reader(doc), pointer_: pointer_starts }, { rel_links: [], controls, patterns }, load_step);
}
