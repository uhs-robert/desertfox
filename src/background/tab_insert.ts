// Insert mode for a whole tab, started by `i`. The background owns it: it sends one message to every frame and keeps the hold, and the frames only obey.

import type { Mode } from "../shared/command.ts";
import { clear_insert_hold, read_insert_hold, write_insert_hold } from "./tab_modes.ts";

type HoldStorage = Parameters<typeof read_insert_hold>[0] & Parameters<typeof clear_insert_hold>[0] & Parameters<typeof write_insert_hold>[0];

export type TabInsertDeps = {
  storage: HoldStorage;
  // Settles when the modes of the last browser session are forgotten. A hold from that session must not reach a restored tab.
  modes_cleared: Promise<unknown>;
  // Reaches every frame of the tab that runs a content script, with no list of frames. A frame under an all-off rule drops it, and a tab with no content script rejects.
  send_mode: (tab_id: number, mode: "insert" | "normal") => Promise<unknown>;
};

export function create_tab_insert(deps: TabInsertDeps) {
  const send_to_all = (tab_id: number, mode: "insert" | "normal") => deps.send_mode(tab_id, mode).catch(() => undefined);

  // Each hold operation reads the hold and then writes it and sends, so two at once in one tab could send in the wrong order or leave twice. They run one after another per tab, in the order their messages arrived.
  const queues = new Map<number, Promise<unknown>>();
  const in_turn = <T>(tab_id: number, operation: () => Promise<T>): Promise<T> => {
    const result = (queues.get(tab_id) ?? Promise.resolve()).then(async () => {
      await deps.modes_cleared;
      return operation();
    });
    const tail = result.catch(() => undefined);
    queues.set(tab_id, tail);
    void tail.then(() => queues.get(tab_id) === tail && queues.delete(tab_id));
    return result;
  };

  const leave = (tab_id: number): Promise<void> =>
    in_turn(tab_id, async () => {
      if (!(await read_insert_hold(deps.storage, tab_id))) return;
      await clear_insert_hold(deps.storage, tab_id);
      await send_to_all(tab_id, "normal");
    });

  return {
    enter: (tab_id: number): Promise<void> =>
      in_turn(tab_id, async () => {
        await write_insert_hold(deps.storage, tab_id);
        await send_to_all(tab_id, "insert");
      }),
    leave,
    // While the tab is held, the top frame reports normal only when the whole tab goes to normal (Escape, mode.set, the toolbar), so the report returns the frames itself. Its leave_tab_insert message may arrive before or after the report: the first of the two returns the frames and the second finds no hold.
    // Any other mode (ignore from the toolbar or ,i) only ends the hold, so the frames keep the mode they were sent.
    top_frame_left_insert: (tab_id: number, mode: Mode): Promise<void> => (mode === "normal" ? leave(tab_id) : in_turn(tab_id, () => clear_insert_hold(deps.storage, tab_id))),
    // A frame that loads while the tab is held starts in insert mode. The reply for a frame under an all-off rule never asks to join, so it stays in ignore mode.
    join: (tab_id: number, _frame_id: number): Promise<boolean> => in_turn(tab_id, () => read_insert_hold(deps.storage, tab_id)),
  };
}
