// Reports the mode on every change and once at start. Normal is the start mode and never fires a change,
// so without the first report the background keeps the mode of the page this one replaced.

import type { Mode } from "../shared/command.ts";
import type { FrameFocus } from "../shared/messages.ts";

export function wire_mode_reports(state: { get_mode: () => Mode; listen: (listener: (mode: Mode) => void) => void }, report: (mode: Mode) => void): void {
  state.listen(report);
  report(state.get_mode());
}

// The background follows the frame whose window holds focus. A window's focus and blur events reach only listeners on the window itself, since they do not bubble.
// Showing a tab fires focus on the top window too when a child frame holds the focus, so on focus `report` gets no value and checks `holds_own_focus` itself.
// A frame that unloads while focused may get no blur, so leaving the page also gives the focus up.
export function wire_focus_reports(win: Pick<Window, "addEventListener">, report: (focus?: FrameFocus) => void): void {
  win.addEventListener("focus", (event) => event.target === win && report());
  win.addEventListener("blur", (event) => event.target === win && report("lost"));
  win.addEventListener("pagehide", () => report("lost"));
}

// A document whose focused element is a frame has handed focus to that frame, though `hasFocus` still says true.
export const holds_own_focus = (doc: Pick<Document, "hasFocus" | "activeElement">): boolean =>
  doc.hasFocus() && doc.activeElement?.localName !== "iframe" && doc.activeElement?.localName !== "frame";
