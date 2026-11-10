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
  const frame_is_all_off = async (frame: { frame_id: number; url: string }, tab_url: string | undefined): Promise<boolean> => {
    const stored = (await deps.storage.get(COMPILED_KEYMAP_STORAGE_KEY))[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
    const rule = site_rule_for(current_keymap(stored), rule_addresses_of({ frameId: frame.frame_id, url: frame.url, tab: { url: tab_url } }));
    return rule !== undefined && "all_off" in rule;
  };
  const send_to_all = (tab_id: number, frame_ids: number[], mode: "insert" | "normal") => Promise.all(frame_ids.map((frame_id) => deps.send_mode(tab_id, frame_id, mode).catch(() => undefined)));

  return {
    // Frames under an all-off rule stay in ignore mode.
    async enter(tab_id: number): Promise<void> {
      await deps.modes_cleared;
      const tab_url = await deps.tab_url(tab_id);
      const switched: number[] = [];
      for (const frame of await deps.frames(tab_id)) if (!(await frame_is_all_off(frame, tab_url))) switched.push(frame.frame_id);
      await write_insert_hold(deps.storage, tab_id, switched);
      await send_to_all(tab_id, switched, "insert");
    },
    // Only the frames the hold switched go back to normal.
    async leave(tab_id: number): Promise<void> {
      await deps.modes_cleared;
      const switched = await read_insert_hold(deps.storage, tab_id);
      await clear_insert_hold(deps.storage, tab_id);
      if (switched) await send_to_all(tab_id, switched, "normal");
    },
    // A frame that loads while the tab is held starts in insert mode, unless its page's rule is all-off, and then it is not switched.
    async join(tab_id: number, frame_id: number): Promise<boolean> {
      await deps.modes_cleared;
      const switched = await read_insert_hold(deps.storage, tab_id);
      if (switched === undefined) return false;
      if (!switched.includes(frame_id)) await write_insert_hold(deps.storage, tab_id, [...switched, frame_id]);
      return true;
    },
  };
}
