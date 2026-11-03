// Walks the command history with Up and Down. The line being typed is kept as a draft, so Down past the newest entry brings it back.

export type HistoryCursor = {
  // Older entry, or undefined when there is none. `current` is the text now in the line.
  prev: (current: string) => string | undefined;
  // Newer entry or the draft, or undefined when already at the draft.
  next: () => string | undefined;
  // The user edited the line: the next Up starts again from the newest entry.
  reset: () => void;
};

// `entries` run from oldest to newest.
export function create_history_cursor(entries: readonly string[]): HistoryCursor {
  let position = entries.length;
  let draft = "";
  return {
    prev: (current) => {
      if (position === 0) return undefined;
      if (position === entries.length) draft = current;
      position -= 1;
      return entries[position];
    },
    next: () => {
      if (position >= entries.length) return undefined;
      position += 1;
      return position === entries.length ? draft : entries[position];
    },
    reset: () => {
      position = entries.length;
    },
  };
}
