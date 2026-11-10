import { deepest_focused_element, is_editable_element } from "../editable.ts";
import { type_at_caret } from "../text/field_writer.ts";

// Types keys into the focused field as text and returns the keys it left alone, in order.
// Queued hint keys are single characters, so each one is its own text.
// It takes nothing unless every key is a plain printable character, which keeps the whole batch in one place.
export function insert_into_focused_field(keys: string[]): string[] {
  if (!is_editable_element(deepest_focused_element())) return keys;
  if (!keys.every((key) => /^[^\p{Cc}]$/u.test(key))) return keys;
  for (const [index, key] of keys.entries()) {
    if (!type_at_caret(key)) return keys.slice(index);
  }
  return [];
}
