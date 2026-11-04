// The tab each window was on before its current one: the tab `#` marks in the tab list. `lastAccessed` cannot give it,
// because a tab opened in the background gets that time at creation and would look like the tab the user came from.

import { PREVIOUS_TAB_STORAGE_PREFIX } from "./storage_keys.ts";

type PreviousTabStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export function create_previous_tabs(storage: PreviousTabStorage) {
  const key_of = (window_id: number) => PREVIOUS_TAB_STORAGE_PREFIX + window_id;
  const previous_of = async (window_id: number): Promise<number | undefined> => {
    const stored = (await storage.get(key_of(window_id)))[key_of(window_id)];
    return typeof stored === "number" ? stored : undefined;
  };
  // Writes run one after another, so a close cannot read the value an activation is about to replace.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (write: () => Promise<void>) => {
    queue = queue.then(write).catch(() => {});
    return queue;
  };
  return {
    previous_of,
    // A window's first activation has no previous tab.
    activated: (window_id: number, previous_tab_id: number | undefined): Promise<void> =>
      enqueue(() => (previous_tab_id === undefined ? storage.remove(key_of(window_id)) : storage.set({ [key_of(window_id)]: previous_tab_id }))),
    removed: (tab_id: number, window_id: number, window_closing: boolean): Promise<void> =>
      enqueue(async () => {
        if (window_closing || (await previous_of(window_id)) === tab_id) await storage.remove(key_of(window_id));
      }),
  };
}
