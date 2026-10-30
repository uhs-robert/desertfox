import type { ScrollCandidate, ScrollAxis } from "../scroll_target.ts";
import { LINE_PIXELS, percent_to_offset, pick_scroll_target } from "../scroll_target.ts";
import type { ContentHandler } from "./types.ts";

export const SCROLL_TO_DEFAULT_AXIS = "y";

const is_scrolling_overflow = (value: string) => value === "auto" || value === "scroll" || value === "overlay";

function candidate_of(element: Element): ScrollCandidate<Element> {
  const style = getComputedStyle(element);
  return {
    ref: element,
    can_scroll_x: element.scrollWidth > element.clientWidth && is_scrolling_overflow(style.overflowX),
    can_scroll_y: element.scrollHeight > element.clientHeight && is_scrolling_overflow(style.overflowY),
    area: element.clientWidth * element.clientHeight,
  };
}

function page_candidate(): ScrollCandidate<Element> | undefined {
  const root = document.scrollingElement;
  if (!root) return undefined;
  return {
    ref: root,
    can_scroll_x: root.scrollWidth > root.clientWidth,
    can_scroll_y: root.scrollHeight > root.clientHeight,
    area: root.clientWidth * root.clientHeight,
  };
}

function focus_chain(): ScrollCandidate<Element>[] {
  const chain: ScrollCandidate<Element>[] = [];
  for (let element = document.activeElement; element; element = element.parentElement) {
    if (element !== document.body && element !== document.documentElement) chain.push(candidate_of(element));
  }
  return chain;
}

function scroll_target(axis: ScrollAxis): Element {
  const target = pick_scroll_target(
    focus_chain(),
    page_candidate(),
    () => Array.from(document.querySelectorAll("*"), candidate_of),
    axis,
  );
  return target ?? document.scrollingElement ?? document.documentElement;
}

const scroll_by = (dx: number, dy: number) => {
  const axis = dy !== 0 ? "y" : "x";
  scroll_target(axis).scrollBy({ left: dx, top: dy, behavior: "instant" });
};

export const scroll_lines: ContentHandler = {
  run: (args) => scroll_by(0, Number(args.count ?? 1) * LINE_PIXELS),
  count: { param: "count" },
};

export const scroll_pixels: ContentHandler = {
  run: (args) => scroll_by(Number(args.dx ?? 0), Number(args.dy ?? 0)),
  count: "ignore",
};

export const scroll_pages: ContentHandler = {
  run: (args) => scroll_by(0, Number(args.fraction ?? 1) * scroll_target("y").clientHeight),
  count: "ignore",
};

export const scroll_to: ContentHandler = {
  run: (args) => {
    const axis = (args.axis ?? SCROLL_TO_DEFAULT_AXIS) as ScrollAxis;
    const target = scroll_target(axis);
    const percent = Number(args.percent);
    if (axis === "x") {
      target.scrollTo({ left: percent_to_offset(percent, target.scrollWidth, target.clientWidth), behavior: "instant" });
    } else {
      target.scrollTo({ top: percent_to_offset(percent, target.scrollHeight, target.clientHeight), behavior: "instant" });
    }
  },
  count: "ignore",
};
