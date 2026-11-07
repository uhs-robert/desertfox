// The badge and the toast live in the `ui` bundle. A call made before it loads waits for the load and is not lost.
// Neither holds keys, because drawing does not change how they replay.

import { remove_badge_hosts } from "./badge_hosts.ts";
import { bundles } from "./bundles.ts";
import type { ToastKind } from "../shared/messages.ts";

const MISSING = "DesertFox could not load ui";

export const show_toast = (message: string, kind?: ToastKind): void => void bundles.run_command("ui.toast", "ui", { message, kind }, MISSING, false);

// Every draw passes this one object. A draw queued while ui.js loads can run after a later draw that found the handler registered, so each draw reads the newest label.
const badge_args: { label: string | undefined; mode: string | undefined } = { label: undefined, mode: undefined };

// Hiding first removes hosts an earlier instance left, which needs no bundle. Only the top frame draws the badge. A frame with no badge to remove does not load the bundle.
export function show_mode_label(label: string | undefined, mode?: string): void {
  if (label === undefined) remove_badge_hosts();
  if (window !== window.top || (label === undefined && !bundles.has_handler("ui.badge"))) return;
  Object.assign(badge_args, { label, mode });
  void bundles.run_command("ui.badge", "ui", badge_args, MISSING, false);
}
