// The tab rows of the live tab model, as the `tab` list shows them. Pure: the page feeds in the port's messages and sends the resync request.
// The model sends a snapshot, then patches numbered one more each. A patch that skips a number means a missed one, so the client asks for a new snapshot and ignores patches until it lands.

import type { TabItem, TabModelMessage, TabRow } from "../../shared/messages.ts";

export type ModelClientDeps = {
  // The window of the line's tab: only it marks `%` and `#`, and it lists first.
  line_window_id: number;
  all_windows: boolean;
  request_resync: () => void;
  // Rows changed: `upserted` holds the ids a patch touched, empty for a snapshot.
  on_change: (upserted: readonly number[]) => void;
};

const one_line = (text: string) => text.replace(/\s+/g, " ").trim();

export function create_model_client(deps: ModelClientDeps) {
  const rows = new Map<number, TabRow>();
  let rev = -1;
  let waiting_for_snapshot = true;

  const item_of = (row: TabRow): TabItem => {
    const in_line_window = row.window_id === deps.line_window_id;
    return {
      id: row.id,
      number: row.index + 1,
      window_number: row.window_number,
      title: one_line(row.title || row.url),
      url: row.url,
      ...(row.favicon_url ? { favicon: row.favicon_url } : {}),
      ...(row.container_color || row.container_icon ? { container: { color: row.container_color, icon: row.container_icon } } : {}),
      ...(row.active && in_line_window ? { active: true as const } : {}),
      ...(row.previous && !row.active && in_line_window ? { alternate: true as const } : {}),
      ...(row.pinned ? { pinned: true as const } : {}),
      // A muted tab that plays sound is audible too, and the speaker would contradict the crossed one.
      ...(row.audible && !row.muted ? { audible: true as const } : {}),
      ...(row.muted ? { muted: true as const } : {}),
      ...(row.discarded ? { discarded: true as const } : {}),
    };
  };

  const shown = (row: TabRow) => deps.all_windows || row.window_id === deps.line_window_id;

  return {
    receive: (message: TabModelMessage) => {
      if (message.type === "snapshot") {
        rows.clear();
        for (const row of message.tabs) rows.set(row.id, row);
        rev = message.rev;
        waiting_for_snapshot = false;
        deps.on_change([]);
        return;
      }
      if (waiting_for_snapshot) return;
      if (message.rev !== rev + 1) {
        waiting_for_snapshot = true;
        deps.request_resync();
        return;
      }
      rev = message.rev;
      for (const id of message.removed) rows.delete(id);
      for (const row of message.upserts) rows.set(row.id, row);
      deps.on_change(message.upserts.map((row) => row.id));
    },
    // Undefined until the first snapshot. The line's window first, then by window and place, as `listed_tabs` orders them.
    items: (): TabItem[] | undefined =>
      rev < 0
        ? undefined
        : [...rows.values()]
            .filter(shown)
            .sort((a, b) => Number(b.window_id === deps.line_window_id) - Number(a.window_id === deps.line_window_id) || a.window_id - b.window_id || a.index - b.index)
            .map(item_of),
    item_of_id: (id: number): TabItem | undefined => {
      const row = rows.get(id);
      return row && shown(row) ? item_of(row) : undefined;
    },
  };
}

export type ModelClient = ReturnType<typeof create_model_client>;
