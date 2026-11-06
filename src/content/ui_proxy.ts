// The badge and the toast live in the `ui` bundle. A call made before it loads waits for the load and is not lost.
// Neither holds keys, because drawing does not change how they replay.

import { remove_badge_hosts } from "./badge_hosts.ts";
import { bundles } from "./bundles.ts";
import type { ToastKind } from "../shared/messages.ts";
import type { BadgeColors } from "./mode_indicator.ts";

const MISSING = "DesertFox could not load ui";

export const show_toast = (message: string, kind?: ToastKind): void => void bundles.run_command("ui.toast", "ui", { message, kind }, MISSING, false);

// Hiding first removes hosts an earlier instance left, which needs no bundle. Only the top frame draws the badge. A frame with no badge to remove does not load the bundle.
export function show_mode_label(label: string | undefined, colors?: BadgeColors): void {
  if (label === undefined) remove_badge_hosts();
  if (window !== window.top || (label === undefined && !bundles.has_handler("ui.badge"))) return;
  void bundles.run_command("ui.badge", "ui", { label, colors }, MISSING, false);
}
