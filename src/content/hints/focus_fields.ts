// The form control that `page.focus_field` (`]i`, `[i`) moves to. The pick is pure and the page reads sit apart, so tests run on plain lists.

import { deepest_focused_element } from "../editable.ts";
import { collect, window_of } from "./candidates.ts";
import type { Found } from "./candidates.ts";
import { keep_present_found } from "./headings.ts";

export type FieldDirection = "next" | "prev";

// Every control a person can focus to fill in or press: text fields, selects, checkboxes, radios and every kind of button. A hidden input has no box. A disabled one takes no focus, also through a disabled `fieldset`, so the test is `:disabled` and not the attribute.
export const FORM_CONTROLS = 'input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [contenteditable=""], [contenteditable="true"]';

// Where the move starts. `index` is the control the user stands on (`on_field_`), or else the first control after the start point.
export type Place = { index: number; on_field_: boolean };

export type FieldPick = { index: number } | { end: true };

// A count that runs past the last control stops on it. Already past the end is the stop the user sees as a toast.
export function pick_field(length: number, place: Place, direction: FieldDirection, steps: number): FieldPick {
  const first = direction === "next" ? (place.on_field_ ? place.index + 1 : place.index) : place.index - 1;
  if (first < 0 || first >= length) return { end: true };
  const index = direction === "next" ? first + steps - 1 : first - steps + 1;
  return { index: Math.min(Math.max(index, 0), length - 1) };
}

// The first anchor that is one of the controls wins: the focused element, then the last one blurred. A focused link or the page body is no control, so it gives way.
// With no anchor the start is the first control that is not above the view.
export function place_of(fields: readonly Element[], anchors: readonly (Element | null | undefined)[], is_above_view: (field: Element) => boolean): Place {
  for (const anchor of anchors) {
    const index = anchor ? fields.indexOf(anchor) : -1;
    if (index !== -1) return { index, on_field_: true };
  }
  const first_in_view = fields.findIndex((field) => !is_above_view(field));
  return { index: first_in_view === -1 ? fields.length : first_in_view, on_field_: false };
}

const is_above_view = (field: Element): boolean => field.getBoundingClientRect().bottom <= 0;

const is_fully_in_view = (element: Element): boolean => {
  const box = element.getBoundingClientRect();
  const win = window_of(element);
  return box.top >= 0 && box.left >= 0 && box.bottom <= win.innerHeight && box.right <= win.innerWidth;
};

// Each window scrolls only its own document, so the frames that hold the control are centered in turn, innermost first.
// The control is focused first with `preventScroll`, because the default scroll puts it at the edge of the view.
function reveal({ element, frames }: Found): void {
  for (const target of [element, ...[...frames].reverse()]) if (!is_fully_in_view(target)) target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
}

export function focus_field(root: ParentNode, last_blurred: Element | undefined, direction: FieldDirection, steps: number): string | undefined {
  const found = keep_present_found(collect(root, { selector: FORM_CONTROLS }));
  if (found.length === 0) return "No form control on this page";
  const place = place_of(found.map((item) => item.element), [deepest_focused_element(), last_blurred], is_above_view);
  const pick = pick_field(found.length, place, direction, steps);
  if ("end" in pick) return direction === "next" ? "No next form control" : "No previous form control";
  const target = found[pick.index]!;
  (target.element as HTMLElement).focus({ preventScroll: true });
  reveal(target);
  return undefined;
}
