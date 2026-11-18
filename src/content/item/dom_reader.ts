// The live page for the detector in `next_page/detect.ts` and the item finder: a `PageReader` over real elements.

import { shadow_root_of } from "../shadow.ts";
import { is_shown } from "../shown.ts";
import { once } from "../next_page/detect.ts";
import type { Box, PageReader } from "../next_page/detect.ts";

const style_of = (element: Element): CSSStyleDeclaration => element.ownerDocument.defaultView!.getComputedStyle(element);

// Only where a pointer cursor starts: a child of a clickable card inherits it. The root has no parent, so it never starts one. The load step of `]]` adds it to the reader.
export const pointer_starts = (element: Element): boolean => style_of(element).cursor === "pointer" && style_of(element.parentElement ?? element).cursor !== "pointer";

// Boxes are in the coordinates of the element's own document.
export const dom_reader = (doc: Document): PageReader<Element> => {
  const read_box = (element: Element): Box | undefined => {
    if (!is_shown(element)) return undefined;
    const box = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView!;
    return { x: box.left + view.scrollX, y: box.top + view.scrollY, w: box.width, h: box.height };
  };
  // A content script reads the page through a wrapper that makes each DOM call cost more, and the finder asks the same tag and attribute many times, so each read happens once per reader.
  const attr_readers = new Map<string, (element: Element) => string | null>();
  const shadow_roots: ShadowRoot[] = [];
  return {
    root_: doc.documentElement,
    parent_: once((element) => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null),
    children_: once((element) => {
      const shadow = shadow_root_of(element);
      if (shadow) shadow_roots.push(shadow);
      return [...Array.from(element.children), ...Array.from(shadow?.children ?? [])];
    }),
    tag_: once((element) => element.localName),
    attr_: (element, name) => (attr_readers.get(name) ?? attr_readers.set(name, once((at: Element) => at.getAttribute(name))).get(name)!)(element),
    text_: (element) => (element as HTMLElement).innerText ?? element.textContent ?? "",
    box_: once(read_box),
    query_all_: (selector) => [doc, ...shadow_roots].flatMap((root) => Array.from(root.querySelectorAll(selector))),
    // A track that scrolls sideways, or one that hides a much wider row (a carousel that moves by transform).
    scrolls_sideways_: once((element) => {
      const { overflowX } = style_of(element);
      const { clientWidth, scrollWidth } = element;
      return clientWidth > 0 && ((/auto|scroll/.test(overflowX) && scrollWidth > clientWidth + 20) || (/hidden|clip/.test(overflowX) && scrollWidth > 1.5 * clientWidth && element.children.length > 0 && clientWidth > 150));
    }),
    same_page_: (link) => `${(link as HTMLAnchorElement).href}`.split("#")[0] === location.href.split("#")[0],
    pinned_: once((element) => /fixed|sticky/.test(style_of(element).position)),
    text_length_: once((element) => (element.textContent ?? "").trim().length),
    view_: () => ({ w: innerWidth, h: innerHeight, page_h: doc.documentElement.scrollHeight }),
  };
};
