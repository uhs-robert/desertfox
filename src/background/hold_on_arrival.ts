// A page that loads in the replay's tab asks for its keymap before it installs its key matcher. Holding the page before that reply closes the gap between the page's start and the hold the replay sends once the load completes.

import type { MacroReplay } from "./macro_replay.ts";
import { best_effort } from "../shared/swallow.ts";

// The reply waits for the hold. A frame that is gone cannot hold keys and must not block the reply, and a frame that never answers is given up on after a short wait.
const HOLD_WAIT_MS = 200;

export async function reply_after_hold<T>(
  replay: Pick<MacroReplay, "holds_tab">,
  send_hold: (tab_id: number, frame_id: number | undefined) => Promise<unknown>,
  tab_id: number | undefined,
  frame_id: number | undefined,
  reply: () => Promise<T>,
): Promise<T> {
  if (tab_id !== undefined && replay.holds_tab(tab_id)) {
    let give_up: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise((resolve) => (give_up = setTimeout(resolve, HOLD_WAIT_MS)));
    await Promise.race([best_effort(send_hold(tab_id, frame_id)), timeout]);
    clearTimeout(give_up);
  }
  return reply();
}
