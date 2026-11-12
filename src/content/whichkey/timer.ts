// Starts the which-key panel after a pause in a half-typed sequence. The next key, a reset or a mode change cancels it.

import type { PendingPrefix } from "../key_flow.ts";

// A prefix shows the panel for it, no prefix hides the panel. `is_current_` turns false once a later key came, because the bundle may answer after that.
// `drawn` tells the timer a nonempty panel is up, so the next prefix key may redraw it without the delay.
export type AskWhichKey = (prefix: PendingPrefix | undefined, is_current: () => boolean, drawn: () => void) => unknown;

// `get_delay_ms` returns zero or nothing when which-key is off. `get_skip` lists the typed-key strings whose panel waits for the delay and so never shows by itself: a redraw that is instant (Backspace, or a panel already up) ignores it. Plain arguments rather than an object keep the content script small.
export function create_which_key_timer(get_delay_ms: () => number | undefined, ask: AskWhichKey, get_skip?: () => readonly string[] | undefined): (prefix: PendingPrefix | undefined, at_once?: boolean) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let epoch = 0;
  // True once a panel is drawn, until a key that leaves the prefix tree. The delay only keeps the panel from flashing at a fast typist, so a panel already up follows the next prefix key at once.
  let shown = false;
  return (prefix, at_once) => {
    clearTimeout(timer);
    const instant = at_once || shown;
    shown = false;
    const mine = ++epoch;
    const is_current = () => mine === epoch;
    const drawn = () => void (shown = is_current());
    ask(undefined, is_current, drawn);
    const delay_ms = get_delay_ms();
    if (prefix && delay_ms && (instant || !get_skip?.()?.includes(prefix.typed_.join(""))))
      timer = setTimeout(() => ask(prefix, is_current, drawn), instant ? 0 : delay_ms);
  };
}
