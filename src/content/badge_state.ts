// What content hands the ui bundle for the badge, or undefined where nothing shows.
// Hint and command line modes draw their own surface and the setting can show nothing, so those skip the bundle, unless a recording keeps the badge up.

import type { Mode, ModeIndicator } from "../shared/index.ts";
import type { BadgeState } from "./ui/mode_label.ts";

// A site mode runs inside normal mode, so its label counts only there, and it shows with the setting `not_normal` too.
export function badge_state(mode: Mode, pass_next: boolean, setting: ModeIndicator, recording: string | undefined, site_label?: string): BadgeState | undefined {
  const label = mode === "normal" ? site_label : undefined;
  const quiet = recording === undefined && (mode === "hint" || mode === "cmdline" || setting === "off" || (mode === "normal" && !pass_next && setting === "not_normal" && label === undefined));
  return quiet ? undefined : { mode, pass_next, setting, recording, site_label: label };
}
