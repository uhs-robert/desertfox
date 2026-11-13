// What the browser's history clearing does to the stores that hold page addresses.

type HistoryRemoval = { allHistory: boolean };

export type HistoryHolders = { marks: { clear_normal: () => Promise<void> }; cmdline: { clear_history: () => Promise<void> }; favicons: { clear: () => Promise<unknown> } };

// Only "Clear all history" sends `allHistory`. A clear of a time range or one address sends per-address events, and those keep the marks and the typed lines.
export function clear_on_history_removed(removal: HistoryRemoval, holders: HistoryHolders): Promise<unknown> {
  if (!removal.allHistory) return Promise.resolve();
  return Promise.all([holders.marks.clear_normal(), holders.cmdline.clear_history(), holders.favicons.clear()]);
}
