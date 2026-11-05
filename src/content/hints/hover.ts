// The one hovered element. It outlives the hint session, which ends at the pick, so it lives here.

import { center_of, dispatch_mouse_event } from "./actions.ts";
import type { MouseEventName } from "./actions.ts";

type Point = { x: number; y: number };
type Hoverable = Parameters<typeof dispatch_mouse_event>[0] & { isConnected?: boolean; parentElement?: Hoverable | null; getRootNode?: () => unknown };

// The pointer's last point is kept with the element, so the leave events come from where it entered.
let hovered: { element: Hoverable; at: Point } | undefined;
let watching_tab = false;

// A hidden tab gets no mouseleave from the browser, so a preview would keep playing. The listener goes on at the first hover, so a page that never hovers carries none.
function watch_tab(): void {
  if (watching_tab || typeof document === "undefined") return;
  watching_tab = true;
  document.addEventListener("visibilitychange", () => document.hidden && unhover());
}

// The parent that events and hover follow: the shadow host above a shadow root's top element.
const parent_of = (element: Hoverable): Hoverable | null => element.parentElement ?? (element.getRootNode?.() as { host?: Hoverable } | undefined)?.host ?? null;

function contains(outer: Hoverable, inner: Hoverable | undefined): boolean {
  for (let step = inner ?? null; step; step = parent_of(step)) if (step === outer) return true;
  return false;
}

// The element and its ancestors that the pointer is not still inside, innermost first. An ancestor that contains the other end of the move stays entered.
function path_away_from(element: Hoverable, other: Hoverable | undefined): Hoverable[] {
  const path: Hoverable[] = [];
  for (let step: Hoverable | null = element; step && !contains(step, other); step = parent_of(step)) path.push(step);
  return path;
}

const as_related = (element: Hoverable | undefined) => (element as unknown as EventTarget | undefined) ?? null;

// The leave side of a pointer move from the old element toward the new one, or toward nothing. Synthetic events do not set CSS :hover, so only page scripts react.
function leave(old: { element: Hoverable; at: Point }, toward: Hoverable | undefined): void {
  const left = path_away_from(old.element, toward);
  const related = as_related(toward);
  dispatch_mouse_event(old.element, "pointerout", related, old.at);
  for (const element of left) dispatch_mouse_event(element, "pointerleave", related, old.at);
  dispatch_mouse_event(old.element, "mouseout", related, old.at);
  for (const element of left) dispatch_mouse_event(element, "mouseleave", related, old.at);
}

function enter(target: Hoverable, from: Hoverable | undefined, at: Point): void {
  const entered = path_away_from(target, from).reverse();
  const related = as_related(from);
  dispatch_mouse_event(target, "pointerover", related, at);
  for (const element of entered) dispatch_mouse_event(element, "pointerenter", related, at);
  dispatch_mouse_event(target, "mouseover", related, at);
  for (const element of entered) dispatch_mouse_event(element, "mouseenter", related, at);
  for (const type of ["pointermove", "mousemove"] as const satisfies readonly MouseEventName[]) dispatch_mouse_event(target, type, null, at);
}

// Takes the hovered element and forgets it. An element the page removed gets no events, because nothing listens to it any more.
function release(): NonNullable<typeof hovered> | undefined {
  const old = hovered;
  hovered = undefined;
  return old?.element.isConnected === false ? undefined : old;
}

// A pointer moving between two elements leaves one and enters the other, so a menu the old element opened stays open when the new one is inside it.
export function hover(target: Hoverable): void {
  // A pointer that stays on its element sends nothing, so a preview that closes on out stays open.
  if (hovered?.element === target) return;
  const old = release();
  if (old) leave(old, target);
  const at = center_of(target);
  hovered = { element: target, at };
  watch_tab();
  enter(target, old?.element, at);
}

export function unhover(): void {
  const old = release();
  if (old) leave(old, undefined);
}

// Another pick moves the pointer to its target. A target inside the hovered element becomes the hovered one, so Escape still closes the menu around it.
export function leave_toward(target: Hoverable): void {
  const old = release();
  if (!old) return;
  leave(old, target);
  if (contains(old.element, target)) hovered = { element: target, at: center_of(target) };
}
