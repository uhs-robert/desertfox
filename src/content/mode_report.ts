// Reports the mode on every change and once at start. Normal is the start mode and never fires a change,
// so without the first report the background keeps the mode of the page this one replaced.

import type { Mode } from "../shared/command.ts";

export function wire_mode_reports(state: { get_mode_: () => Mode; listen: (listener: (mode: Mode) => void) => void }, report: (mode: Mode) => void): void {
  state.listen(report);
  report(state.get_mode_());
}

// The background follows the frame whose document holds the keyboard focus. A document whose focused element holds a window (an iframe, a frame, an object) has handed the focus to that window, though `hasFocus` still says true.
export const holds_own_focus = (doc: Pick<Document, "hasFocus" | "activeElement">): boolean => doc.hasFocus() && !(doc.activeElement as Partial<HTMLIFrameElement> | null)?.contentWindow;
