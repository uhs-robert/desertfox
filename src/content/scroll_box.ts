// Reads whether an element is a box that scrolls. Shared by the scroll keys and the `scrollable` hint filter.

import type { ScrollCandidate } from "./scroll_target.ts";

const is_scrolling_overflow = (value: string) => value === "auto" || value === "scroll" || value === "overlay";

type BoxStyle = { overflowX: string; overflowY: string };

export function candidate_of(element: Element, style: BoxStyle = getComputedStyle(element)): ScrollCandidate<Element> {
  return {
    ref: element,
    can_scroll_x: element.scrollWidth > element.clientWidth && is_scrolling_overflow(style.overflowX),
    can_scroll_y: element.scrollHeight > element.clientHeight && is_scrolling_overflow(style.overflowY),
    area: element.clientWidth * element.clientHeight,
  };
}

// The page itself is left out: it scrolls without a hint.
export function is_scroll_box(element: Element, style?: BoxStyle): boolean {
  if (element === element.ownerDocument.documentElement || element === element.ownerDocument.body) return false;
  const candidate = candidate_of(element, style);
  return candidate.can_scroll_x || candidate.can_scroll_y;
}
