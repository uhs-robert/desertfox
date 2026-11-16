import { queued_in_page, send_key, wait_for_gap } from "./send_key.ts";

export type ArrowDirection = "left" | "down" | "up" | "right";
export type ArrowArgs = { direction: ArrowDirection; times?: number };

// What the handler needs from the page, so a test passes fakes. `focused` is the deepest focused element, through shadow roots.
export type ArrowPage = { focused: () => Element | null; scroll_by: (dx: number, dy: number) => void; make_event: (type: string, init: KeyboardEventInit) => Event };

// Firefox ignores an untrusted arrow on its own controls, so each native control is moved through its DOM API. The scroll distance is that of the normal-mode keys.
const SCROLL_PX = 50;
const KEYS = { left: [37, -SCROLL_PX, 0], down: [40, 0, SCROLL_PX], up: [38, 0, -SCROLL_PX], right: [39, SCROLL_PX, 0] } as const;

type Control = Omit<HTMLSelectElement & HTMLInputElement, "type"> & { type: string };

const fire_changed = (control: EventTarget) => ["input", "change"].forEach((type) => control.dispatchEvent(new Event(type, { bubbles: true })));

// A select stops at its ends, and a radio group wraps, as the native keys do.
function step_select(select: Control, delta: number): void {
  let index = select.selectedIndex + delta;
  while (select.options[index]?.disabled) index += delta;
  if (!select.options[index]) return;
  select.selectedIndex = index;
  fire_changed(select);
}

// A click makes the browser check the radio and fire click, input and change, which is what a script framework listens to. A checked flag set from script reads as no change to it.
function step_radio(radio: Control, delta: number): void {
  const group = Array.from((radio.form ?? (radio.getRootNode() as ParentNode)).querySelectorAll<Control>('input[type="radio"]')).filter((other) => other.name === radio.name && other.form === radio.form && (!other.disabled || other === radio));
  const next = radio.name ? group[(group.indexOf(radio) + delta + group.length) % group.length] : undefined;
  if (!next || next === radio) return;
  next.focus();
  next.click();
}

// A range with step="any" has no step to take, and stepUp throws. The value then moves by one percent of the span, set through the prototype so a framework that tracks the value sees it change.
function step_range(range: Control, grow: boolean): void {
  const before = range.value;
  try {
    grow ? range.stepUp() : range.stepDown();
  } catch {
    const step = ((Number(range.max) || 100) - (Number(range.min) || 0)) / 100;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(range), "value")!.set!.call(range, String(Number(before) + (grow ? step : -step)));
  }
  if (range.value !== before) fire_changed(range);
}

export function arrow_step(page: ArrowPage, direction: ArrowDirection): void {
  const [key_code, dx, dy] = KEYS[direction];
  const delta = direction === "down" || direction === "right" ? 1 : -1;
  const element = page.focused() as Control | null;
  if (!element || element.tagName === "BODY" || element.tagName === "HTML") return page.scroll_by(dx, dy);
  if (element.tagName === "SELECT") return step_select(element, delta);
  // A number input is a text field, so the mode has already ended there.
  if (element.tagName === "INPUT" && element.type === "range") return step_range(element, direction === "up" || direction === "right");
  if (element.tagName === "INPUT" && element.type === "radio") return step_radio(element, delta);
  // A page that handles the arrow cancels it. One that does not, such as a clicked link or button, gets the scroll instead.
  const kept = send_key({ activeElement: element, querySelector: () => null }, { key: `Arrow${direction[0]!.toUpperCase()}${direction.slice(1)}`, key_code }, page.make_event);
  if (kept) page.scroll_by(dx, dy);
}

export const arrow_queued = (page: ArrowPage, { direction, times = 1 }: ArrowArgs): Promise<void> =>
  queued_in_page(async () => {
    for (let step = 0; step < times; step++) {
      if (step > 0) await wait_for_gap();
      arrow_step(page, direction);
    }
  });
