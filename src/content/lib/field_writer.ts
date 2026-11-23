import { RuntimeRefusal } from "../../shared/command.ts";
import { deepest_focused_element } from "../editable.ts";
import { is_editable_in_frame } from "./host_editable.ts";

// A replayed key is never a real keydown, so the page default cannot type it. `execCommand` goes through the editing path, so React and Vue fields see a real input event.
export const type_at_caret = (text: string): boolean => document.execCommand("insertText", false, text);

// Types into the focused field, else into the field the last Escape left (`last_left`), and refuses when there is neither.
// Escape blurs a field, so a replay after one always lands in the second case.
export function write_into_field(text: string, last_left: Element | undefined): void {
  if (!is_editable_in_frame(deepest_focused_element())) {
    if (!(last_left instanceof HTMLElement && last_left.isConnected && is_editable_in_frame(last_left))) throw new RuntimeRefusal("No text field to type into");
    last_left.focus();
  }
  if (!type_at_caret(text)) throw new RuntimeRefusal("The field did not take the text");
}
