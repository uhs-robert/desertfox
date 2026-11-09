import type { ScrollCandidate, ScrollAxis } from "../scroll_target.ts";
import { LINE_PIXELS, percent_to_offset, pick_scroll_target } from "../scroll_target.ts";
import { candidate_of } from "../scroll_box.ts";
import { deepest_focused_element } from "../editable.ts";
import type { ContentHandler } from "./types.ts";

export const SCROLL_TO_DEFAULT_AXIS = "y";

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
  for (let element = deepest_focused_element(); element; element = element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null) {
    if (element !== document.body && element !== document.documentElement) chain.push(candidate_of(element));
  }
  return chain;
}

function scroll_target(axis: ScrollAxis): Element {
  const target = pick_scroll_target(
    focus_chain(),
    page_candidate(),
    () => Array.from(document.querySelectorAll("*"), (element) => candidate_of(element)),
    axis,
  );
  return target ?? document.scrollingElement ?? document.documentElement;
}

// Firefox decides whether "smooth" animates (general.smoothScroll). A held key restarts the animation on every repeat and lags far behind the key, so repeats jump.
const smooth_unless = (repeat: boolean): ScrollBehavior => (repeat ? "instant" : "smooth");

const scroll_by = (dx: number, dy: number, behavior: ScrollBehavior = "instant") => {
  const axis = dy !== 0 ? "y" : "x";
  scroll_target(axis).scrollBy({ left: dx, top: dy, behavior });
};

export const scroll_lines: ContentHandler = {
  run: (args) => scroll_by(0, Number(args.count) * LINE_PIXELS),
};

export const scroll_pixels: ContentHandler = {
  run: (args) => scroll_by(Number(args.dx), Number(args.dy)),
};

export const scroll_pages: ContentHandler = {
  run: (args, repeat) => scroll_by(0, Number(args.fraction) * Number(args.count) * scroll_target("y").clientHeight, smooth_unless(repeat)),
};

export const scroll_to: ContentHandler = {
  run: (args, repeat) => {
    const axis = args.axis as ScrollAxis;
    const behavior = smooth_unless(repeat);
    const target = scroll_target(axis);
    const percent = Number(args.percent);
    if (axis === "x") {
      target.scrollTo({ left: percent_to_offset(percent, target.scrollWidth, target.clientWidth), behavior });
    } else {
      target.scrollTo({ top: percent_to_offset(percent, target.scrollHeight, target.clientHeight), behavior });
    }
  },
};
