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

let scroll_selector = "";

export const set_scroll_selector = (selector = ""): void => {
  scroll_selector = selector;
};

// A selector that does not parse selects nothing.
function site_candidate(): ScrollCandidate<Element> | undefined {
  try {
    const element = scroll_selector && document.querySelector(scroll_selector);
    return element ? candidate_of(element) : undefined;
  } catch {
    return undefined;
  }
}

// The box the whole-page scan chose, per axis. Weak, so a removed box is not held.
const kept_box: Partial<Record<ScrollAxis, WeakRef<Element>>> = {};

const forget_kept_boxes = () => {
  delete kept_box.x;
  delete kept_box.y;
};

// A pane that starts to scroll later (a slow load, a view opened by key) beats the kept box only if the keep ends. A pause between bursts ends it, and the repeats of a held key come faster than this.
const KEEP_IDLE_MS = 1000;
let last_scroll_key_at = 0;

// A box that is gone or no longer scrolls on the axis fails the re-check, and the scan runs again.
function kept_candidates(axis: ScrollAxis): ScrollCandidate<Element>[] {
  const element = kept_box[axis]?.deref();
  if (!element?.isConnected) return [];
  const candidate = candidate_of(element);
  return (axis === "x" ? candidate.can_scroll_x_ : candidate.can_scroll_y_) ? [candidate] : [];
}

export function scroll_target(axis: ScrollAxis): Element {
  const now = Date.now();
  if (now - last_scroll_key_at > KEEP_IDLE_MS) forget_kept_boxes();
  last_scroll_key_at = now;
  let scanned = false;
  const target = pick_scroll_target(
    site_candidate(),
    focus_chain(),
    page_candidate(),
    () => {
      const kept = kept_candidates(axis);
      if (kept.length) return kept;
      scanned = true;
      return Array.from(document.querySelectorAll("*"), (element) => candidate_of(element));
    },
    axis,
  );
  if (scanned && target) {
    kept_box[axis] = new WeakRef(target);
    // The same function added twice is one listener.
    addEventListener("focusin", forget_kept_boxes, true);
    addEventListener("pointerdown", forget_kept_boxes, true);
  }
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

// A scroll pressed while the body is still on its way finds no room and would be lost. It waits in order for DOMContentLoaded. A press that repeats the last queued one adds nothing, so a burst of j is one step. A later press that finds room runs the queue first. The queue runs in one tick, so its entries run instant: a smooth scroll would be cut short by the next one. An empty key means the press moves nothing.
const waiting: { key: string; run: (instant: boolean) => void }[] = [];

const run_waiting = () => waiting.splice(0).forEach((entry) => entry.run(true));

const when_laid_out = (key: string, axis: ScrollAxis, run: (instant: boolean) => void) => {
  if (!key) return;
  const target = document.readyState === "loading" && scroll_target(axis);
  if (!target || (axis === "y" ? target.scrollHeight > target.clientHeight : target.scrollWidth > target.clientWidth)) {
    run_waiting();
    return run(false);
  }
  // The same function added twice is one listener, so no check is needed.
  document.addEventListener("DOMContentLoaded", run_waiting);
  if (waiting.at(-1)?.key !== key) waiting.push({ key, run });
};

const move_by = (dx: number, dy: number) => {
  end_flight();
  scroll_target(dy !== 0 ? "y" : "x").scrollBy({ left: dx, top: dy, behavior: "instant" });
};

const scroll_by = (dx: number, dy: number) => when_laid_out(dx || dy ? `by ${dx} ${dy}` : "", dy !== 0 ? "y" : "x", () => move_by(dx, dy));

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
    const pages = Number(args.fraction) * Number(args.count);
    when_laid_out(pages ? `pages ${pages}` : "", "y", (instant) => {
      const target = scroll_target("y");
      const distance = pages * target.clientHeight;
      if (repeat || instant) move_by(0, distance);
      else smooth_page_tap(target, distance);
    });
  },
};

export const scroll_to: ContentHandler = {
  run: (args, repeat) => {
    const axis = args.axis as ScrollAxis;
    when_laid_out(`to ${axis} ${args.percent}`, axis, (instant) => {
      end_flight();
      const target = scroll_target(axis);
      const percent = Number(args.percent);
      const behavior = smooth_unless(repeat || instant);
      if (axis === "x") {
        target.scrollTo({ left: percent_to_offset(percent, target.scrollWidth, target.clientWidth), behavior });
      } else {
        target.scrollTo({ top: percent_to_offset(percent, target.scrollHeight, target.clientHeight), behavior });
      }
    });
  },
};
