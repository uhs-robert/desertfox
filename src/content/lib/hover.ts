// The one hovered element. It outlives the hint session, which ends at the pick, so it lives here.

import { center_of, contains, dispatch_mouse_event, enter_events, leave_events } from "../pointer_events.ts";
import type { Hoverable, MouseEventName, Point } from "../pointer_events.ts";

// The pointer's last point is kept with the element, so the leave events come from where it entered.
// `entry_from_` is set while the element is recorded as hovered but its entry events were not sent, and names the element the pointer came from.
let hovered: { element_: Hoverable; at_: Point; entry_from_?: Hoverable } | undefined;
let watching_tab = false;

// A hidden tab gets no mouseleave from the browser, so a preview would keep playing. The listener goes on at the first hover or click pick, so a page that never does either carries none.
function watch_tab(): void {
  if (watching_tab || typeof document === "undefined") return;
  watching_tab = true;
  document.addEventListener("visibilitychange", () => document.hidden && unhover());
}

function enter(target: Hoverable, from: Hoverable | undefined, at: Point): void {
  enter_events(target, from, at);
  for (const type of ["pointermove", "mousemove"] as const satisfies readonly MouseEventName[]) dispatch_mouse_event(target, type, null, at);
}

// Takes the hovered element and forgets it. An element the page removed gets no events, because nothing listens to it any more.
function release(): NonNullable<typeof hovered> | undefined {
  const old = hovered;
  hovered = undefined;
  return old?.element_.isConnected === false ? undefined : old;
}

// A pointer moving between two elements leaves one and enters the other, so a menu the old element opened stays open when the new one is inside it.
export function hover(target: Hoverable): void {
  // A pointer that stays on its element sends nothing, so a preview that closes on out stays open.
  if (hovered?.element_ === target) {
    const { entry_from_, at_: at } = hovered;
    if (entry_from_) enter(target, entry_from_, at);
    delete hovered.entry_from_;
    return;
  }
  const old = release();
  if (old) leave_events(old, target);
  const at = center_of(target);
  hovered = { element_: target, at_: at };
  watch_tab();
  enter(target, old?.element_, at);
}

export function unhover(): void {
  const old = release();
  if (old) leave_events(old, undefined);
}

// Another pick moves the pointer to its target. A target inside the hovered element becomes the hovered one, so Escape still closes the menu around it. That target has not been entered yet: a later hover sends the entry, unless the pick enters it first with `enter_for_click`. Returns the element the pointer came from, for that entry: a pending target's own entry source when the pick lands on it again.
export function leave_toward(target: Hoverable): Hoverable | undefined {
  const old = release();
  if (!old) return undefined;
  leave_events(old, target);
  const came_from = old.entry_from_ ?? old.element_;
  if (contains(old.element_, target)) hovered = { element_: target, at_: center_of(target), entry_from_: came_from };
  return came_from;
}

// The entry a click gives its target, from the element `leave_toward` returned. It sends no pointer motion. The target is then the hovered element, as under a real mouse, so the next pick or Escape leaves it and a second pick inside one menu enters the menu's ancestors only once.
export function enter_for_click(target: Hoverable, from: Hoverable | undefined): void {
  const at = center_of(target);
  enter_events(target, from, at);
  hovered = { element_: target, at_: at };
  watch_tab();
}
