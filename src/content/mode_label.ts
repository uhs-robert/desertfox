// What the mode indicator says. Pure, so it is testable without a DOM.

import type { Mode, ModeIndicator } from "../shared/index.ts";

const MODE_LABELS: Partial<Record<Mode, string>> = { normal: "NORMAL", insert: "INSERT", ignore: "IGNORE", caret: "CARET", visual: "VISUAL", visual_line: "V-LINE" };

// Hint and command line modes draw their own surface, so they get no label here.
export function mode_label(mode: Mode, pass_next_armed: boolean, setting: ModeIndicator, recording?: string): string | undefined {
  const label = setting === "off" ? undefined : pass_next_armed ? "PASS" : mode === "normal" && setting === "not_normal" ? undefined : MODE_LABELS[mode];
  // A recording shows whatever the setting says, because keys are being kept.
  return recording === undefined ? label : `${label ?? ""} recording @${recording}`.trim();
}
