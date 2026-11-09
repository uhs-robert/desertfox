import { deepest_focused_element, is_editable_element } from "../editable.ts";

// Types keys into the focused field as text and returns the keys it left alone, in order.
// A replayed key is never a real keydown, so the page default cannot type it. Queued hint keys are single characters, so each one is its own text.
// It takes nothing unless every key is a plain printable character, which keeps the whole batch in one place.
export function insert_into_focused_field(keys: string[]): string[] {
  if (!is_editable_element(deepest_focused_element())) return keys;
  if (!keys.every((key) => /^[^\p{Cc}]$/u.test(key))) return keys;
  for (const [index, key] of keys.entries()) {
    if (!document.execCommand("insertText", false, key)) return keys.slice(index);
  }
  return [];
}
