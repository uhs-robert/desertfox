// The one hovered element. It outlives the hint session, which ends at the pick, so it lives here.

import { dispatch_mouse_event } from "./actions.ts";
import type { MouseEventName } from "./actions.ts";

const ENTER_EVENTS: readonly MouseEventName[] = ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"];
const LEAVE_EVENTS: readonly MouseEventName[] = ["pointerout", "pointerleave", "mouseout", "mouseleave"];

type Hoverable = Parameters<typeof dispatch_mouse_event>[0] & { isConnected?: boolean };

let hovered: Hoverable | undefined;
let watching_tab = false;

// A hidden tab gets no mouseleave from the browser, so a preview would keep playing. The listener goes on at the first hover, so a page that never hovers carries none.
function watch_tab(): void {
  if (watching_tab || typeof document === "undefined") return;
  watching_tab = true;
  document.addEventListener("visibilitychange", () => document.hidden && unhover());
}

// A new hover ends the old one first, as a pointer moving between two elements does. Synthetic events do not set CSS :hover, so only page scripts react.
export function hover(target: Hoverable): void {
  unhover();
  hovered = target;
  watch_tab();
  for (const type of ENTER_EVENTS) dispatch_mouse_event(target, type);
}

// An element the page removed gets no events, because nothing listens to it any more.
export function unhover(): void {
  const target = hovered;
  hovered = undefined;
  if (!target || target.isConnected === false) return;
  for (const type of LEAVE_EVENTS) dispatch_mouse_event(target, type);
}
