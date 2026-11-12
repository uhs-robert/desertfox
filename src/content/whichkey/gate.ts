// The content.js side of which-key: decides which prefix changes reach the `whichkey` bundle, which holds the timer.

import type { BundleHost } from "../bundle_host.ts";
import type { PendingPrefix } from "../key_flow.ts";

// True once content.js has asked, so a later hide reaches the bundle even while its load is pending.
let asked = false;

// One rule: a call goes through when it may open a panel (the timer is on and the prefix is not in the skip list, or the redraw is instant), or when the bundle may hold something a call must reach. That is true once content.js has asked, because a hide sent while the load is pending must cancel the timer that load starts, and when a manual panel loaded the bundle by itself.
export function follow_which_key(host: BundleHost, prefix: PendingPrefix | undefined, at_once: boolean | undefined, delay_ms: number | undefined, skip: readonly string[] | undefined): void {
  if ((prefix && delay_ms && (at_once || !skip?.includes(prefix.typed_.join("")))) || asked || host.has_handler_("whichkey")) {
    asked = true;
    void host.run_command_("whichkey", "whichkey", { prefix, at_once, delay_ms, skip }, "", false);
  }
}
