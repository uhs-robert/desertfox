// The tab rows of the live tab model, as the `tab` list shows them. Pure: the page feeds in the port's messages and sends the resync request.
// The model sends a snapshot, then patches numbered one more each. A patch that skips a number means a missed one, so the client asks for a new snapshot and ignores patches until it lands.

import { group_labels } from "../../shared/group_name.ts";
import type { GroupRow, SessionItem, TabItem, TabModelMessage, TabRow } from "../../shared/messages.ts";

export type ModelClientDeps = {
  // The window of the line's tab: only it marks `%` and `#`, and it lists first.
  line_window_id: number;
  all_windows: boolean;
  request_resync: () => void;
  // A snapshot or a patch changed the rows.
  on_change: () => void;
};

const one_line = (text: string) => text.replace(/\s+/g, " ").trim();

export function create_model_client(deps: ModelClientDeps) {
  const rows = new Map<number, TabRow>();
  const groups = new Map<number, GroupRow>();
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


  // Undefined until the first snapshot. The line's window first, then by window and place, as `listed_tabs` orders them.
  const listed_items = (all_windows = deps.all_windows): TabItem[] | undefined =>
    rev < 0
      ? undefined
      : [...rows.values()]
          .filter((row) => all_windows || row.window_id === deps.line_window_id)
          .sort((a, b) => Number(b.window_id === deps.line_window_id) - Number(a.window_id === deps.line_window_id) || a.window_id - b.window_id || a.index - b.index)
          .map(item_of);

  // The groups of the line's window, named as `group_labels` names them. Undefined until the first snapshot.
  const read_group_items = (): SessionItem[] | undefined => {
    if (rev < 0) return undefined;
    const mine = [...groups.values()].filter((group) => group.window_id === deps.line_window_id).sort((a, b) => a.id - b.id);
    const labels = group_labels(mine);
    return mine.map((group) => ({ name: labels.get(group.id)!, description: group.collapsed ? "collapsed" : "" }));
  };

  // A patch for a tab the list does not show, or one that changes nothing shown, must not rank the list again: that would reset its scroll position.
  let reported: string | undefined;
  // The finder lists every window, so a change in any window is a change of its list.
  let watches_all = false;
  // A group change reranks the list only once a source asked for groups, as for `watches_all`.
  let watches_groups = false;
  const report_change = () => {
    const key = JSON.stringify([listed_items(watches_all || undefined), watches_groups ? read_group_items() : undefined]);
    if (key === reported) return;
    reported = key;
    deps.on_change();
  };

  return {
    receive: (message: TabModelMessage) => {
      if (message.type === "snapshot") {
        rows.clear();
        for (const row of message.tabs) rows.set(row.id, row);
        groups.clear();
        for (const group of message.groups) groups.set(group.id, group);
        rev = message.rev;
        waiting_for_snapshot = false;
        report_change();
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
      for (const id of message.groups_removed ?? []) groups.delete(id);
      for (const group of message.groups ?? []) groups.set(group.id, group);
      report_change();
    },
    items: listed_items,
    group_items: (): SessionItem[] | undefined => {
      watches_groups = true;
      return read_group_items();
    },
    // Every window's rows, and a change in any of them reports.
    all_items: (): TabItem[] | undefined => {
      watches_all = true;
      return listed_items(true);
    },
  };
}

export type ModelClient = ReturnType<typeof create_model_client>;
