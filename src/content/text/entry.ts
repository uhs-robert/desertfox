import type { Invocation } from "../../shared/invocation.ts";
import { deepest_focused_element, is_editable_element } from "../editable.ts";

// The command that focused a text field, kept for the recorder (D1 of the dot-repeat plan). It sits on `window` because the commands that set it and the recorder live in different bundles.
type EntryWindow = { desertfox_text_entry?: { field_: Element; step_: Invocation } };
const holder = () => window as unknown as EntryWindow;

// Called by a command right after it focused a field. A command that left no text field focused marks nothing.
export function mark_text_entry(step: Invocation): void {
  const field = deepest_focused_element();
  if (field && is_editable_element(field)) holder().desertfox_text_entry = { field_: field, step_: step };
}

// The entry holds for one insert session only, so a session in any field spends it, and a field other than the entry's gets none.
export function take_text_entry(field: Element | null): Invocation | undefined {
  const entry = holder().desertfox_text_entry;
  delete holder().desertfox_text_entry;
  return entry?.field_ === field ? entry.step_ : undefined;
}
