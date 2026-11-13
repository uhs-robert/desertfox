// A subframe tells the background when it goes from shown to hidden, so the keys can return to the top frame. A frame that starts hidden and grows (a panel that animates open) is not hidden: only a frame that was shown can hide.

import { is_too_small_to_show } from "./hidden_frame.ts";

export function watch_frame_hide(report: () => void, win: Pick<Window, "addEventListener" | "innerWidth" | "innerHeight"> = window): void {
  let shown = false;
  const check = () => {
    const now = !is_too_small_to_show({ width: win.innerWidth, height: win.innerHeight });
    if (shown && !now) report();
    shown = now;
  };
  win.addEventListener("resize", check);
  check();
}
