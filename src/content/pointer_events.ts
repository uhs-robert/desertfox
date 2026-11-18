// The pointer events of a real mouse, which the hover pick (`;h`) of the hints bundle sends. Synthetic events do not set CSS :hover, so only page scripts react to them.

export type MouseEventName =
  | "pointerover" | "pointerenter" | "pointermove" | "pointerout" | "pointerleave" | "pointerdown" | "pointerup"
  | "mouseover" | "mouseenter" | "mousemove" | "mouseout" | "mouseleave" | "mousedown" | "mouseup" | "click" | "dblclick";

export type Point = { x: number; y: number };
type EventTarget_ = { dispatchEvent?: (event: Event) => boolean; getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } };
export type Hoverable = EventTarget_ & { isConnected?: boolean; parentElement?: Hoverable | null; getRootNode?: () => unknown };

export function center_of(target: EventTarget_): Point {
  const box = target.getBoundingClientRect?.();
  return { x: box ? box.left + box.width / 2 : 0, y: box ? box.top + box.height / 2 : 0 };
}

// One mouse-side event as the left button sends it. Returns false when the page cancelled it. The enter and leave events do not bubble. The point defaults to the middle of the target. A move across several elements passes one point, so every event of it agrees. `detail` is the click count.
export function dispatch_mouse_event(target: EventTarget_, type: MouseEventName, related_target: EventTarget | null = null, at: Point = center_of(target), detail = 0): boolean {
  if (!target.dispatchEvent) return true;
  const stays_inside = /(enter|leave)$/.test(type);
  const init = { bubbles: !stays_inside, cancelable: true, composed: !stays_inside, button: 0, buttons: type.endsWith("down") ? 1 : 0, relatedTarget: related_target, clientX: at.x, clientY: at.y };
  // A browser sends `click` as a PointerEvent too, so the synthetic one is built the same way. The other pointer events carry no click count.
  const pointer = type[0] === "p";
  return target.dispatchEvent(new (pointer || type === "click" ? PointerEvent : MouseEvent)(type, { ...init, ...(pointer ? {} : { detail }), pointerType: "mouse", isPrimary: true }));
}

// The parent that events and hover follow: the shadow host above a shadow root's top element.
export const parent_of = (element: Hoverable): Hoverable | null => element.parentElement ?? (element.getRootNode?.() as { host?: Hoverable } | undefined)?.host ?? null;

export function contains(outer: Hoverable, inner: Hoverable | undefined): boolean {
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

// The leave side of a pointer move from the old element toward the new one, or toward nothing. The pointer events go first, then the mouse events, as in a browser.
export function leave_events(old: { element_: Hoverable; at_: Point }, toward: Hoverable | undefined): void {
  const left = path_away_from(old.element_, toward);
  const related = as_related(toward);
  for (const kind of ["pointer", "mouse"] as const) {
    dispatch_mouse_event(old.element_, `${kind}out`, related, old.at_);
    for (const element of left) dispatch_mouse_event(element, `${kind}leave`, related, old.at_);
  }
}

// The enter side of a move without the pointer motion. The enter events go to the target and every ancestor, shadow hosts included, that the pointer was not in.
export function enter_events(target: Hoverable, from: Hoverable | undefined, at: Point): void {
  const entered = path_away_from(target, from).reverse();
  const related = as_related(from);
  for (const kind of ["pointer", "mouse"] as const) {
    dispatch_mouse_event(target, `${kind}over`, related, at);
    for (const element of entered) dispatch_mouse_event(element, `${kind}enter`, related, at);
  }
}
