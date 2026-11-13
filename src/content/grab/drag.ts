// Synthetic drag input for the grab bundle, in three routes picked by the source element. A draggable element gets DragEvents with a new DataTransfer, because mouse events never start a native drag. A range input gets a value plus `input` and `change`, because mouse events do not move one. Any other element gets the pointer and mouse sequence of a press, moves and a release.
// Every route ends in `release` or `abort`, so a page never keeps a button or a drag open.

export type Point = { x: number; y: number };
export type Route = "html5" | "range" | "pointer";
export type Direction = "left" | "down" | "up" | "right";

export type Held = {
  route: Route;
  source: HTMLElement;
  start: Point;
  at: Point;
  // The html5 route: the data the page's handlers read and write, the element under the drag, and whether it accepted the last dragover.
  data?: DataTransfer;
  over?: Element;
  droppable?: boolean;
  // The range route: the value to put back on a cancel.
  start_value?: string;
};

const STEP_PX = 24;
const DRIVE_STEPS = 8;
const STEP_PAUSE_MS = 30;

// The ids Firefox gives its real mouse. A page that calls `setPointerCapture` with this id can still get a NotFoundError, which stays the page's own failure and never stops the drag.
const MOUSE_POINTER_ID = 0;

const OFFSET: Record<Direction, Point> = { left: { x: -STEP_PX, y: 0 }, down: { x: 0, y: STEP_PX }, up: { x: 0, y: -STEP_PX }, right: { x: STEP_PX, y: 0 } };

export function center_of(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

const under = (doc: Document, point: Point): Element => doc.elementFromPoint(point.x, point.y) ?? doc.body;

// A page handler that throws does not stop the dispatch, but a constructor or a frozen target can, and the drag must still reach its end events.
const fire = (target: EventTarget, event: Event): boolean => {
  try {
    return target.dispatchEvent(event);
  } catch {
    return true;
  }
};

export function route_of(element: Element): { route: Route; source: HTMLElement } {
  const draggable = element.closest<HTMLElement>('[draggable="true"]');
  if (draggable) return { route: "html5", source: draggable };
  const is_range = element.localName === "input" && (element as HTMLInputElement).type === "range";
  return { route: is_range ? "range" : "pointer", source: element as HTMLElement };
}

function drag_event(held: Held, type: string, point: Point, related: Element | null = null): DragEvent {
  return new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: held.data!, clientX: point.x, clientY: point.y, screenX: point.x, screenY: point.y, relatedTarget: related });
}

function send_pointer(phase: "down" | "move" | "up", target: Element, point: Point): void {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, screenX: point.x, screenY: point.y, button: 0, buttons: phase === "up" ? 0 : 1 };
  fire(target, new PointerEvent(`pointer${phase}`, { ...init, pointerId: MOUSE_POINTER_ID, pointerType: "mouse", isPrimary: true }));
  fire(target, new MouseEvent(`mouse${phase}`, init));
}

// Undefined when the page cancels the start of a drag.
export function press(element: Element): Held | undefined {
  const { route, source } = route_of(element);
  const start = center_of(source);
  const held: Held = { route, source, start, at: start };
  if (route === "html5") {
    held.data = new DataTransfer();
    if (!fire(source, drag_event(held, "dragstart", start))) return undefined;
  } else if (route === "range") held.start_value = (source as HTMLInputElement).value;
  else send_pointer("down", source, start);
  return held;
}

function write_range(held: Held, value: string): void {
  const input = held.source as HTMLInputElement;
  if (input.value === value) return;
  input.value = value;
  fire(input, new Event("input", { bubbles: true }));
}

function range_to_point(held: Held, point: Point): void {
  const input = held.source as HTMLInputElement;
  const box = input.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (point.x - box.left) / box.width));
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  write_range(held, String(min + fraction * (max - min)));
}

function hover(held: Held, target: Element, point: Point): void {
  if (held.over !== target) {
    if (held.over) fire(held.over, drag_event(held, "dragleave", point, target));
    fire(target, drag_event(held, "dragenter", point, held.over ?? null));
    held.over = target;
  }
  // A cancelled dragover is the page saying the spot takes a drop.
  held.droppable = !fire(target, drag_event(held, "dragover", point));
}

export function move_to(held: Held, point: Point): void {
  held.at = point;
  if (held.route === "range") return range_to_point(held, point);
  const target = under(held.source.ownerDocument, point);
  if (held.route === "html5") hover(held, target, point);
  else send_pointer("move", target, point);
}

// A range input steps its value, and the other routes move the pointer a few pixels.
export function nudge(held: Held, direction: Direction): void {
  if (held.route !== "range") return move_to(held, { x: held.at.x + OFFSET[direction].x, y: held.at.y + OFFSET[direction].y });
  const input = held.source as HTMLInputElement;
  const before = input.value;
  try {
    if (direction === "up" || direction === "right") input.stepUp();
    else input.stepDown();
  } catch {
    // A range with step "any" has no step.
  }
  if (input.value !== before) fire(input, new Event("input", { bubbles: true }));
}

export function release(held: Held): void {
  if (held.route === "range") fire(held.source, new Event("change", { bubbles: true }));
  else if (held.route === "pointer") send_pointer("up", under(held.source.ownerDocument, held.at), held.at);
  else {
    if (held.over && held.droppable) fire(held.over, drag_event(held, "drop", held.at));
    else if (held.over) fire(held.over, drag_event(held, "dragleave", held.at));
    fire(held.source, drag_event(held, "dragend", held.at));
  }
}

// The drag goes back to where it began before it ends, so a board does not drop the item on the spot where the cancel came.
export function abort(held: Held): void {
  if (held.route === "range") {
    write_range(held, held.start_value!);
    return release(held);
  }
  if (held.route === "html5") {
    if (held.over) fire(held.over, drag_event(held, "dragleave", held.at));
    fire(held.source, drag_event(held, "dragend", held.at));
    return;
  }
  move_to(held, held.start);
  release(held);
}

const pause = () => new Promise<void>((done) => setTimeout(done, STEP_PAUSE_MS));

// Moves in steps with a pause between them, as a hand does, so a library that reads a few moves before it starts sees them. Stopped, or failed by a page, the drag still ends: stopped puts it back, the rest releases.
export async function drive(held: Held, to: Point, stopped: () => boolean): Promise<void> {
  const from = held.at;
  let cancelled = false;
  try {
    for (let step = 1; step <= DRIVE_STEPS; step++) {
      await pause();
      if ((cancelled = stopped())) return;
      move_to(held, { x: from.x + ((to.x - from.x) * step) / DRIVE_STEPS, y: from.y + ((to.y - from.y) * step) / DRIVE_STEPS });
    }
    await pause();
    cancelled = stopped();
  } finally {
    if (cancelled) abort(held);
    else release(held);
  }
}
