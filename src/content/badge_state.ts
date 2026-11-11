// What content hands the ui bundle for the badge, or undefined where nothing shows.
// Hint and command line modes draw their own surface and the setting can show nothing, so those skip the bundle, unless a recording keeps the badge up.

import type { Mode, ModeIndicator } from "../shared/index.ts";
import type { BadgeState } from "./ui/mode_label.ts";

export function badge_state(mode: Mode, pass_next: boolean, setting: ModeIndicator, recording: string | undefined): BadgeState | undefined {
  const quiet = recording === undefined && (mode === "hint" || mode === "cmdline" || setting === "off" || (mode === "normal" && !pass_next && setting === "not_normal"));
  return quiet ? undefined : { mode, pass_next, setting, recording };
}
