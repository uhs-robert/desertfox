// What the mode indicator says. Pure, so it is testable without a DOM.

import type { Mode, ModeIndicator } from "../shared/index.ts";

const MODE_LABELS: Partial<Record<Mode, string>> = { normal: "NORMAL", insert: "INSERT", ignore: "IGNORE" };

// Hint and command line modes draw their own surface, so they get no label here.
export function mode_label(mode: Mode, pass_next_armed: boolean, setting: ModeIndicator): string | undefined {
  if (setting === "off") return undefined;
  if (pass_next_armed) return "PASS";
  if (mode === "normal" && setting === "not_normal") return undefined;
  return MODE_LABELS[mode];
}
