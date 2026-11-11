// The badge and the toast live in the `ui` bundle. A call made before it loads waits for the load and is not lost.
// Neither holds keys, because drawing does not change how they replay.

import { remove_badge_hosts } from "./badge_hosts.ts";
import { bundles } from "./bundles.ts";
import type { ToastKind } from "../shared/messages.ts";
import type { BadgeState } from "./ui/mode_label.ts";

const MISSING = "DesertFox could not load ui";

export const show_toast = (message: string, kind?: ToastKind): void => void bundles.run_command_("ui.toast", "ui", { message, kind }, MISSING, false);

// Content passes the state and the ui bundle words the label. A state of `undefined` hides the badge: that removes hosts an earlier instance left, which needs no bundle. Only the top frame draws the badge. A frame with no badge to remove does not load the bundle.
export function show_mode_label(state?: BadgeState): void {
  if (state === undefined) remove_badge_hosts();
  if (window !== window.top || (state === undefined && !bundles.has_handler_("ui.badge"))) return;
  void bundles.run_command_("ui.badge", "ui", { ...state }, MISSING, false);
}
