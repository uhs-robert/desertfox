// The live page for the detector in `detect.ts`: the `rel` links, the links and buttons, and a `PageReader` over real elements.

import { BUTTONS, collect, LINKS, name_candidates } from "../hints/candidates.ts";
import type { Found } from "../hints/candidates.ts";
import { keep_present_found } from "../hints/headings.ts";
import { has_usable_address } from "../hints/actions.ts";
import { shadow_root_of } from "../shadow.ts";
import { detect_next_page } from "./detect.ts";
import type { Box, LoadStep, NextPageAction, PageReader } from "./detect.ts";

export type FollowDirection = "next" | "prev";

const rel_selector = (direction: FollowDirection): string => ["link", "a", "area"].map((tag) => `${tag}[rel~="${direction}"][href]`).join(", ");

// The first `rel` link in document order, across same-origin frames and shadow roots. It needs no box, because a `<link>` in the head has none.
export const find_rel_link = (root: ParentNode, direction: FollowDirection): Found | undefined => collect(root, { selector: rel_selector(direction) })[0];

export const texts_of = (element: Element): string[] => name_candidates(element, (element as HTMLElement).innerText ?? element.textContent);

const style_of = (element: Element): CSSStyleDeclaration => element.ownerDocument.defaultView!.getComputedStyle(element);

// Boxes are in the coordinates of the element's own document. One reader serves one `]]` press: each box is read once, and the cache goes with the reader.
export const dom_reader = (doc: Document): PageReader<Element> => {
  const boxes = new Map<Element, Box | undefined>();
  const read_box = (element: Element): Box | undefined => {
    if (!element.getClientRects().length || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return undefined;
    const box = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView!;
    return { x: box.left + view.scrollX, y: box.top + view.scrollY, w: box.width, h: box.height };
  };
  return {
  root_: doc.documentElement,
  parent_: (element) => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null,
  children_: (element) => [...Array.from(element.children), ...Array.from(shadow_root_of(element)?.children ?? [])],
  tag_: (element) => element.localName,
  attr_: (element, name) => element.getAttribute(name),
  text_: (element) => (element as HTMLElement).innerText ?? element.textContent ?? "",
  box_: (element) => {
    if (!boxes.has(element)) boxes.set(element, read_box(element));
    return boxes.get(element);
  },
  // A track that scrolls sideways, or one that hides a much wider row (a carousel that moves by transform).
  scrolls_sideways_: (element) => {
    const { overflowX } = style_of(element);
    const { clientWidth, scrollWidth } = element;
    return clientWidth > 0 && ((/auto|scroll/.test(overflowX) && scrollWidth > clientWidth + 20) || (/hidden|clip/.test(overflowX) && scrollWidth > 1.5 * clientWidth && element.children.length > 0 && clientWidth > 150));
  },
  pinned_: (element) => /fixed|sticky/.test(style_of(element).position),
  view_: () => ({ w: innerWidth, h: innerHeight, page_h: doc.documentElement.scrollHeight }),
  };
};

// The background reads a `javascript:` or `data:` address as typed text and would search for it. A button has no address and is clicked.
export const can_open_elsewhere = (element: HTMLElement): boolean => !("href" in element) || has_usable_address(element, false, true);

// Links and buttons count off screen too: the next link usually sits at the bottom. The page is only searched when it has no rel link.
export function find_next_page(doc: Document, direction: FollowDirection, patterns: readonly string[], load_step?: LoadStep): NextPageAction<Element> {
  const rel = find_rel_link(doc, direction);
  if (rel) return { action: "follow", target: rel.element };
  const links = keep_present_found(collect(doc, { selector: LINKS }));
  const items = [...links, ...keep_present_found(collect(doc, { selector: BUTTONS }))];
  const controls = items.map((item, place) => ({ node: item.element, texts: texts_of(item.element), is_link: place < links.length }));
  return detect_next_page(dom_reader(doc), { rel_links: [], controls, patterns }, load_step);
}
