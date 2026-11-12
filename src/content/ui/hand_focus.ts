// The hand-off of a hidden input frame. content.js asks for it only in a frame that has a frame element, so a top frame never loads this.

import { deepest_focused_element } from "../editable.ts";
import { is_hidden_frame } from "../hidden_frame.ts";
import type { Mode } from "../../shared/command.ts";

// A page that focuses the frame again on each blur trades the focus with the frame without end. A frame that gains the focus within this time of its last hand-off, with no insert mode between, keeps it in normal mode until the user's next Escape.
const REFOCUS_FIGHT_MS = 500;
let handed_off_at_ms = 0;

// In normal mode a hidden input frame gives the focus to the document that holds it, so that document's commands, sinks and panels get the keys. Forwarding keys or commands from the frame leaves hints, the caret and which-key without their later keys.
// Blurring the frame element also clears the frame's own focused element, so `gi` in the parent focuses the field itself (`focus_input.ts`).
// A frame without the focus has nothing to hand off, and must not start the guard time.
// `keep_field` leaves a frame with a focused field alone, for two cases. A window that loses the focus (a hidden tab) blurs its field, which ends insert mode, yet the field takes the focus again when the window does. And a frame whose script starts after the page focused its field is in normal mode until its keymap arrives. `mode.set` passes false, because it leaves the field focused in normal mode for good.
// The mode is read when the call runs, which is after the bundle load on the first call.
export function hand_focus_to_parent(mode: Mode, is_editable: (element: Element | null) => boolean, keep_field: boolean): void {
  // Null in the top frame and in a frame of another site, so only a same-origin child frame hands off.
  const frame = window.frameElement as HTMLElement | null;
  if (mode != "normal") handed_off_at_ms = 0;
  else if (frame && document.hasFocus() && !(keep_field && is_editable(deepest_focused_element())) && is_hidden_frame(frame) && Date.now() - handed_off_at_ms > REFOCUS_FIGHT_MS) {
    handed_off_at_ms = Date.now();
    frame.blur();
  }
}
