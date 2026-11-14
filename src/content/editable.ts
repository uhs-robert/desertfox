import type { FrameSiteValues } from "../shared/prefix_tree.ts";
import { shadow_root_of } from "./shadow.ts";

// Which focused elements take typed text, so insert mode can follow focus.

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "radio", "submit", "reset", "image", "file", "color", "range", "hidden",
]);

export function takes_typing(tag_name: string, input_type: string, is_content_editable: boolean): boolean {
  if (is_content_editable) return true;
  const tag = tag_name.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && !NON_TEXT_INPUT_TYPES.has(input_type.toLowerCase());
}

// The frame's per-site rules for what counts as a field, set from the page keymap reply. `editable_remove_unsized` limits `editable_remove` to elements with no width: Sheets keeps its cell editor focused while a cell is only selected, parked off screen with no width, and gives it the cell's width for an edit. No focus event marks either end, so the key listeners re-read the focus.
let rules: FrameSiteValues<"editable_add" | "editable_remove" | "editable_remove_unsized"> = {};

export const set_editable_rules = (values: typeof rules = {}): void => {
  rules = values;
};

// A selector that does not parse matches nothing, so one bad entry leaves the rest working.
export const matches_any = (element: Element, selectors: string[] = []): boolean =>
  selectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });

export function is_editable_element(target: EventTarget | Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if ((!rules.editable_remove_unsized || target.offsetWidth < 1) && matches_any(target, rules.editable_remove)) return false;
  return matches_any(target, rules.editable_add) || takes_typing(target.tagName, target instanceof HTMLInputElement ? target.type : "", target.isContentEditable);
}

// Focus inside a shadow root shows on the host only, so the walk goes down to the inner element.
// `start` is a parameter so a test can pass stub elements.
export function deepest_focused_element(start: Element | null = document.activeElement): Element | null {
  let focused = start;
  while (focused && shadow_root_of(focused)?.activeElement) focused = shadow_root_of(focused)!.activeElement;
  return focused;
}
