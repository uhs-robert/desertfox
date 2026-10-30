// Reports the mode on every change and once at start. Normal is the start mode and never fires a change,
// so without the first report the background keeps the mode of the page this one replaced.

import type { Mode } from "../shared/command.ts";

export function wire_mode_reports(state: { get_mode: () => Mode; listen: (listener: (mode: Mode) => void) => void }, report: (mode: Mode) => void): void {
  state.listen(report);
  report(state.get_mode());
}
