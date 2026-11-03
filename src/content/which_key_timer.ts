// Starts the which-key panel after a pause in a half-typed sequence. The next key, a reset or a mode change cancels it.

import type { PendingPrefix } from "./key_flow.ts";

// A prefix shows the panel for it, no prefix hides the panel. `is_current` turns false once a later key came, because the bundle may answer after that.
export type AskWhichKey = (prefix: PendingPrefix | undefined, is_current: () => boolean) => void;

// `get_delay_ms` returns zero or nothing when which-key is off. Plain arguments rather than an object keep the content script small.
export function create_which_key_timer(get_delay_ms: () => number | undefined, ask: AskWhichKey): (prefix: PendingPrefix | undefined, at_once?: boolean) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let epoch = 0;
  return (prefix, at_once) => {
    clearTimeout(timer);
    const mine = ++epoch;
    const is_current = () => mine === epoch;
    ask(undefined, is_current);
    const delay_ms = get_delay_ms();
    if (prefix && delay_ms) timer = setTimeout(() => ask(prefix, is_current), at_once ? 0 : delay_ms);
  };
}
