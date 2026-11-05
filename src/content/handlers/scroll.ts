import type { ScrollCandidate, ScrollAxis } from "../scroll_target.ts";
import { LINE_PIXELS, percent_to_offset, pick_scroll_target } from "../scroll_target.ts";
import { candidate_of } from "../scroll_box.ts";
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

// Focus inside a shadow root shows on the host only, so the walk goes down to the inner element first and climbs out through the hosts.
type ShadowHost = Element & { openOrClosedShadowRoot?: ShadowRoot | null };

function focused_element(): Element | null {
  let element = document.activeElement;
  for (let inner = element; inner; inner = (inner as ShadowHost).openOrClosedShadowRoot?.activeElement ?? (inner as ShadowHost).shadowRoot?.activeElement ?? null) element = inner;
  return element;
}

function focus_chain(): ScrollCandidate<Element>[] {
  const chain: ScrollCandidate<Element>[] = [];
  for (let element = focused_element(); element; element = element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null) {
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

const scroll_by = (dx: number, dy: number) => {
  const axis = dy !== 0 ? "y" : "x";
  scroll_target(axis).scrollBy({ left: dx, top: dy, behavior: "instant" });
};

export const scroll_lines: ContentHandler = {
  run: (args) => scroll_by(0, Number(args.count) * LINE_PIXELS),
};

export const scroll_pixels: ContentHandler = {
  run: (args) => scroll_by(Number(args.dx), Number(args.dy)),
};

export const scroll_pages: ContentHandler = {
  run: (args) => scroll_by(0, Number(args.fraction) * scroll_target("y").clientHeight),
};

export const scroll_to: ContentHandler = {
  run: (args) => {
    const axis = args.axis as ScrollAxis;
    const target = scroll_target(axis);
    const percent = Number(args.percent);
    if (axis === "x") {
      target.scrollTo({ left: percent_to_offset(percent, target.scrollWidth, target.clientWidth), behavior: "instant" });
    } else {
      target.scrollTo({ top: percent_to_offset(percent, target.scrollHeight, target.clientHeight), behavior: "instant" });
    }
  },
};
