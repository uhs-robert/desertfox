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
    can_scroll_x_: root.scrollWidth > root.clientWidth,
    can_scroll_y_: root.scrollHeight > root.clientHeight,
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

export function scroll_target(axis: ScrollAxis): Element {
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

// Firefox restarts a smooth scroll from the animated position, so a second tap would drop the distance the first still had to go. The end of the page scroll in flight is kept and the next tap adds to it.
let in_flight: { target: Element; end: number } | undefined;
let clear_in_flight_timer: ReturnType<typeof setTimeout> | undefined;
const FLIGHT_MS = 600;

export const end_flight = () => {
  clearTimeout(clear_in_flight_timer);
  in_flight = undefined;
};

export const tapped_end = (flight_end: number | undefined, top: number, distance: number, max_top: number): number =>
  Math.min(Math.max((flight_end ?? top) + distance, 0), max_top);

// A scroll pressed while the body is still on its way finds no height and would be lost. It waits for DOMContentLoaded and runs once. Presses during the wait are dropped, so a burst makes one step instead of a jump.
let waiting_for_layout = false;

const scroll_by = (dx: number, dy: number) => {
  end_flight();
  const axis = dy !== 0 ? "y" : "x";
  const target = scroll_target(axis);
  const no_room = axis === "y" ? target.scrollHeight <= target.clientHeight : target.scrollWidth <= target.clientWidth;
  if (no_room && document.readyState === "loading") {
    if (waiting_for_layout) return;
    waiting_for_layout = true;
    document.addEventListener("DOMContentLoaded", () => ((waiting_for_layout = false), scroll_by(dx, dy)), { once: true });
    return;
  }
  target.scrollBy({ left: dx, top: dy, behavior: "instant" });
};

const smooth_page_tap = (target: Element, distance: number) => {
  const end = tapped_end(in_flight?.target === target ? in_flight.end : undefined, target.scrollTop, distance, target.scrollHeight - target.clientHeight);
  clearTimeout(clear_in_flight_timer);
  in_flight = { target, end };
  clear_in_flight_timer = setTimeout(end_flight, FLIGHT_MS);
  target.scrollTo({ top: end, behavior: "smooth" });
};

export const scroll_lines: ContentHandler = {
  run: (args) => scroll_by(0, Number(args.count) * LINE_PIXELS),
};

export const scroll_pixels: ContentHandler = {
  run: (args) => scroll_by(Number(args.dx), Number(args.dy)),
};

export const scroll_pages: ContentHandler = {
  run: (args, repeat) => {
    const target = scroll_target("y");
    const distance = Number(args.fraction) * Number(args.count) * target.clientHeight;
    if (repeat) scroll_by(0, distance);
    else smooth_page_tap(target, distance);
  },
};

export const scroll_to: ContentHandler = {
  run: (args, repeat) => {
    const axis = args.axis as ScrollAxis;
    const behavior = smooth_unless(repeat);
    end_flight();
    const target = scroll_target(axis);
    const percent = Number(args.percent);
    if (axis === "x") {
      target.scrollTo({ left: percent_to_offset(percent, target.scrollWidth, target.clientWidth), behavior });
    } else {
      target.scrollTo({ top: percent_to_offset(percent, target.scrollHeight, target.clientHeight), behavior });
    }
  },
};
