// The windows in the order they were last focused, newest first, for the bare `tab.attach`. Kept in `storage.session` so a background restart keeps the order.

import { WINDOW_FOCUS_STORAGE_KEY } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set">;

// `windows.onFocusChanged` reports this id when focus leaves every Firefox window.
const NO_WINDOW = -1;

export async function read_recent_window_ids(storage: SessionStorage): Promise<number[]> {
  const stored = (await storage.get(WINDOW_FOCUS_STORAGE_KEY))[WINDOW_FOCUS_STORAGE_KEY];
  return Array.isArray(stored) ? stored.filter((id): id is number => typeof id === "number") : [];
}

export function track_window_focus(
  storage: SessionStorage,
  events: { onFocusChanged: { addListener: (listener: (window_id: number) => void) => void }; onRemoved: { addListener: (listener: (window_id: number) => void) => void } },
) {
  // Updates run one after another, so two quick events cannot overwrite each other's read.
  let queue: Promise<void> = Promise.resolve();
  const update = (change: (ids: number[]) => number[]) => {
    queue = queue.then(async () => storage.set({ [WINDOW_FOCUS_STORAGE_KEY]: change(await read_recent_window_ids(storage)) })).catch(() => {});
    return queue;
  };
  events.onFocusChanged.addListener((window_id) => {
    if (window_id !== NO_WINDOW) void update((ids) => [window_id, ...ids.filter((id) => id !== window_id)]);
  });
  events.onRemoved.addListener((window_id) => void update((ids) => ids.filter((id) => id !== window_id)));
  return { settled: () => queue };
}
