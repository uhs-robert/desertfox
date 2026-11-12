// The badge and the toast live in the `ui` bundle. A call made before it loads waits for the load and is not lost.
// Neither holds keys, because drawing does not change how they replay.

import { remove_badge_hosts } from "./badge_hosts.ts";
import { bundles } from "./bundles.ts";
import { DEFAULT_TOAST_ERROR_MS, DEFAULT_TOAST_MS } from "../shared/default_settings.ts";
import type { ToastKind } from "../shared/messages.ts";
import type { BadgeState } from "./ui/mode_label.ts";

const MISSING = "DesertFox could not load ui";

// The keymap carries the durations, so the proxy keeps them and hands the right one to the bundle with each toast.
let toast_ms = DEFAULT_TOAST_MS;
let toast_error_ms = DEFAULT_TOAST_ERROR_MS;
export const set_toast_durations = (keymap: { toast_ms: number; toast_error_ms: number } | undefined): void => {
  toast_ms = keymap?.toast_ms ?? DEFAULT_TOAST_MS;
  toast_error_ms = keymap?.toast_error_ms ?? DEFAULT_TOAST_ERROR_MS;
};

export const show_toast = (message: string, kind?: ToastKind): void =>
  void bundles.run_command_("ui.toast", "ui", { message, kind, duration_ms: (kind ?? "error") === "error" ? toast_error_ms : toast_ms }, MISSING, false);

// Content passes the state and the ui bundle words the label. A state of `undefined` hides the badge: that removes hosts an earlier instance left, which needs no bundle. Only the top frame draws the badge. A frame with no badge to remove does not load the bundle.
export function show_mode_label(state?: BadgeState): void {
  if (state === undefined) remove_badge_hosts();
  if (window !== window.top || (state === undefined && !bundles.has_handler_("ui.badge"))) return;
  void bundles.run_command_("ui.badge", "ui", { ...state }, MISSING, false);
}
