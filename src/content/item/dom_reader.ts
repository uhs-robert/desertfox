// The live page for the detector in `next_page/detect.ts` and the item finder: a `PageReader` over real elements.

import { shadow_root_of } from "../shadow.ts";
import { is_shown } from "../shown.ts";
import { once } from "../next_page/detect.ts";
import type { Box, PageReader } from "../next_page/detect.ts";

const style_of = (element: Element): CSSStyleDeclaration => element.ownerDocument.defaultView!.getComputedStyle(element);

// Boxes are in the coordinates of the element's own document.
export const dom_reader = (doc: Document): PageReader<Element> => {
  const read_box = (element: Element): Box | undefined => {
    if (!is_shown(element)) return undefined;
    const box = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView!;
    return { x: box.left + view.scrollX, y: box.top + view.scrollY, w: box.width, h: box.height };
  };
  return {
    root_: doc.documentElement,
    parent_: (element) => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null,
    children_: once((element) => [...Array.from(element.children), ...Array.from(shadow_root_of(element)?.children ?? [])]),
    tag_: (element) => element.localName,
    attr_: (element, name) => element.getAttribute(name),
    text_: (element) => (element as HTMLElement).innerText ?? element.textContent ?? "",
    box_: once(read_box),
    // A track that scrolls sideways, or one that hides a much wider row (a carousel that moves by transform).
    scrolls_sideways_: once((element) => {
      const { overflowX } = style_of(element);
      const { clientWidth, scrollWidth } = element;
      return clientWidth > 0 && ((/auto|scroll/.test(overflowX) && scrollWidth > clientWidth + 20) || (/hidden|clip/.test(overflowX) && scrollWidth > 1.5 * clientWidth && element.children.length > 0 && clientWidth > 150));
    }),
    pinned_: once((element) => /fixed|sticky/.test(style_of(element).position)),
    // Only where a pointer cursor starts: a child of a clickable card inherits it. The root has no parent, so it never starts one.
    pointer_: (element) => style_of(element).cursor === "pointer" && style_of(element.parentElement ?? element).cursor !== "pointer",
    text_length_: (element) => (element.textContent ?? "").trim().length,
    view_: () => ({ w: innerWidth, h: innerHeight, page_h: doc.documentElement.scrollHeight }),
  };
};
