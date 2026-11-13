// The top frame draws the panel for a subframe. Each draw and erase carries the sender's frame and a count, and a message older than the newest from its frame is dropped, so a slow draw never repaints a panel that was already erased.
// A frame keeps its id when it loads a new document, so a sender starts its count at the document's start time in ms (`performance.timeOrigin`). The new document's first count is above every count of the old one, which sent at most one per ms.
// An erase hides only a panel its own frame drew, so a late erase from one frame leaves the panel of another frame.

import type { WhichKeyPanel } from "../../shared/messages.ts";

export function create_relayed_panel(show: (panel: WhichKeyPanel) => void, hide: () => void) {
  const newest = new Map<unknown, number>();
  let owner: unknown;
  const is_newest = ({ from_frame, seq }: Record<string, unknown>): boolean => {
    // Also false for a message with no count.
    if (!((seq as number) > (newest.get(from_frame) ?? 0))) return false;
    newest.set(from_frame, seq as number);
    return true;
  };
  return {
    draw_: (args: Record<string, unknown>): void => {
      if (!is_newest(args)) return;
      owner = args.from_frame;
      show(args.panel as WhichKeyPanel);
    },
    erase_: (args: Record<string, unknown>): void => {
      if (!is_newest(args) || owner !== args.from_frame) return;
      owner = undefined;
      hide();
    },
  };
}
