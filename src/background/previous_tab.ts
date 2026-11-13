// The tab each window was on before its current one: the tab `#` marks in the tab list. `lastAccessed` cannot give it,
// because a tab opened in the background gets that time at creation and would look like the tab the user came from.

import { PREVIOUS_TAB_STORAGE_PREFIX } from "./storage_keys.ts";
import { create_write_queue } from "./store_turns.ts";

type PreviousTabStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export function create_previous_tabs(storage: PreviousTabStorage) {
  const key_of = (window_id: number) => PREVIOUS_TAB_STORAGE_PREFIX + window_id;
  const stored_previous_of = async (window_id: number): Promise<number | undefined> => {
    const stored = (await storage.get(key_of(window_id)))[key_of(window_id)];
    return typeof stored === "number" ? stored : undefined;
  };
  // Writes run one after another, so a close cannot read the value an activation is about to replace.
  const run_in_turn = create_write_queue();
  let settled: Promise<void> = Promise.resolve();
  // A failed write warns and leaves the old value, and the next write still runs.
  const enqueue = (write: () => Promise<void>) => {
    settled = run_in_turn(write).catch((error: unknown) => console.warn("desertfox: could not save the previous tab", error));
    return settled;
  };
  return {
    // Waits for queued writes, so a read right after an activation sees it. `removed` reads inside the queue and must not wait on it.
    previous_of: async (window_id: number): Promise<number | undefined> => {
      await settled;
      return stored_previous_of(window_id);
    },
    // A window's first activation has no previous tab.
    activated: (window_id: number, previous_tab_id: number | undefined): Promise<void> =>
      enqueue(() => (previous_tab_id === undefined ? storage.remove(key_of(window_id)) : storage.set({ [key_of(window_id)]: previous_tab_id }))),
    removed: (tab_id: number, window_id: number, window_closing: boolean): Promise<void> =>
      enqueue(async () => {
        if (window_closing || (await stored_previous_of(window_id)) === tab_id) await storage.remove(key_of(window_id));
      }),
  };
}
