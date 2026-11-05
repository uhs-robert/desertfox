// The one hovered element. It outlives the hint session, which ends at the pick, so it lives here.

import { dispatch_mouse_event } from "./actions.ts";
import type { MouseEventName } from "./actions.ts";

type Hoverable = Parameters<typeof dispatch_mouse_event>[0] & { isConnected?: boolean; parentElement?: Hoverable | null; contains?: (other: unknown) => boolean };

let hovered: Hoverable | undefined;
let watching_tab = false;

// A hidden tab gets no mouseleave from the browser, so a preview would keep playing. The listener goes on at the first hover, so a page that never hovers carries none.
function watch_tab(): void {
  if (watching_tab || typeof document === "undefined") return;
  watching_tab = true;
  document.addEventListener("visibilitychange", () => document.hidden && unhover());
}

// The element and its ancestors that the pointer is not still inside, innermost first. An ancestor that contains the other end of the move stays entered.
function path_away_from(element: Hoverable, other: Hoverable | undefined): Hoverable[] {
  const path: Hoverable[] = [];
  for (let step: Hoverable | null | undefined = element; step && !step.contains?.(other); step = step.parentElement) path.push(step);
  return path;
}

function send(elements: readonly Hoverable[], type: MouseEventName, related: Hoverable | undefined): void {
  for (const element of elements) dispatch_mouse_event(element, type, (related as unknown as EventTarget) ?? null);
}

// The leave side of a pointer move from the old element toward the new one, or toward nothing. Synthetic events do not set CSS :hover, so only page scripts react.
function leave(old: Hoverable, toward: Hoverable | undefined): void {
  const left = path_away_from(old, toward);
  dispatch_mouse_event(old, "pointerout", (toward as unknown as EventTarget) ?? null);
  send(left, "pointerleave", toward);
  dispatch_mouse_event(old, "mouseout", (toward as unknown as EventTarget) ?? null);
  send(left, "mouseleave", toward);
}

function enter(target: Hoverable, from: Hoverable | undefined): void {
  const entered = path_away_from(target, from).reverse();
  dispatch_mouse_event(target, "pointerover", (from as unknown as EventTarget) ?? null);
  send(entered, "pointerenter", from);
  dispatch_mouse_event(target, "mouseover", (from as unknown as EventTarget) ?? null);
  send(entered, "mouseenter", from);
  dispatch_mouse_event(target, "pointermove");
  dispatch_mouse_event(target, "mousemove");
}

// Takes the hovered element and forgets it. An element the page removed gets no events, because nothing listens to it any more.
function release(): Hoverable | undefined {
  const old = hovered;
  hovered = undefined;
  return old?.isConnected === false ? undefined : old;
}

// A pointer moving between two elements leaves one and enters the other, so a menu the old element opened stays open when the new one is inside it.
export function hover(target: Hoverable): void {
  const old = release();
  if (old) leave(old, target);
  hovered = target;
  watch_tab();
  enter(target, old);
}

export function unhover(): void {
  const old = release();
  if (old) leave(old, undefined);
}

// Another pick moves the pointer to its target. A target inside the hovered element leaves it hovered as far as the page can tell.
export function leave_toward(target: Hoverable): void {
  const old = release();
  if (old) leave(old, target);
}
