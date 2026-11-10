// Insert mode for a whole tab, started by `i`. The background owns it: it switches the frames and keeps the hold, and the frames only obey.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { rule_addresses_of, site_rule_for } from "./page_keymap.ts";
import { clear_insert_hold, read_insert_hold, write_insert_hold } from "./tab_modes.ts";

type HoldStorage = Parameters<typeof read_insert_hold>[0] & Parameters<typeof clear_insert_hold>[0] & Parameters<typeof write_insert_hold>[0] & Pick<typeof browser.storage.local, "get">;

export type TabInsertDeps = {
  storage: HoldStorage;
  // Settles when the modes of the last browser session are forgotten. A hold from that session must not reach a restored tab.
  modes_cleared: Promise<unknown>;
  frames: (tab_id: number) => Promise<{ frame_id: number; url: string }[]>;
  tab_url: (tab_id: number) => Promise<string | undefined>;
  send_mode: (tab_id: number, frame_id: number, mode: "insert" | "normal") => Promise<unknown>;
};

export function create_tab_insert(deps: TabInsertDeps) {
  const is_all_off = (keymap: CompiledKeymap | undefined, frame: { frame_id: number; url: string }, tab_url: string | undefined): boolean => {
    const rule = site_rule_for(keymap, rule_addresses_of({ frameId: frame.frame_id, url: frame.url, tab: { url: tab_url } }));
    return rule !== undefined && "all_off" in rule;
  };
  const send_to_all = (tab_id: number, frame_ids: number[], mode: "insert" | "normal") => Promise.all(frame_ids.map((frame_id) => deps.send_mode(tab_id, frame_id, mode).catch(() => undefined)));

  // Each hold operation reads the list and writes it back, so two at once in one tab would lose a frame. They run one after another per tab, in the order their messages arrived.
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

  return {
    // Frames under an all-off rule stay in ignore mode.
    enter: (tab_id: number): Promise<void> =>
      in_turn(tab_id, async () => {
        const [tab_url, frames, stored] = await Promise.all([deps.tab_url(tab_id), deps.frames(tab_id), deps.storage.get(COMPILED_KEYMAP_STORAGE_KEY)]);
        const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
        const switched = frames.filter((frame) => !is_all_off(keymap, frame, tab_url)).map((frame) => frame.frame_id);
        await write_insert_hold(deps.storage, tab_id, switched);
        await send_to_all(tab_id, switched, "insert");
      }),
    // Only the frames the hold switched go back to normal.
    leave: (tab_id: number): Promise<void> =>
      in_turn(tab_id, async () => {
        const switched = await read_insert_hold(deps.storage, tab_id);
        await clear_insert_hold(deps.storage, tab_id);
        if (switched) await send_to_all(tab_id, switched, "normal");
      }),
    // The top frame left insert by another route (the toolbar, ignore mode), so the hold ends without switching the frames. Escape sends leave before its report, so leave reads the list first.
    end_by_report: (tab_id: number): Promise<void> => in_turn(tab_id, () => clear_insert_hold(deps.storage, tab_id)),
    // A frame that loads while the tab is held starts in insert mode, unless its page's rule is all-off, and then it is not switched.
    join: (tab_id: number, frame_id: number): Promise<boolean> =>
      in_turn(tab_id, async () => {
        const switched = await read_insert_hold(deps.storage, tab_id);
        if (switched === undefined) return false;
        if (!switched.includes(frame_id)) await write_insert_hold(deps.storage, tab_id, [...switched, frame_id]);
        return true;
      }),
  };
}
