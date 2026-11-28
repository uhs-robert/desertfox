// The tab range of tab visual mode. Firefox's own multiselection is the display: the active tab is always in it, so the anchor is the
// active tab and only the cursor end moves. The record `{ anchor, cursor }` per window lives in `storage.session`.

import { TAB_VISUAL_STORAGE_PREFIX } from "../shared/config/storage_keys.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { create_write_queue } from "./store_turns.ts";

export type VisualTab = { id: number; index: number; active: boolean; hidden: boolean; group_id: number };
export type RangeRecord = { anchor: number; cursor: number };
export type VisualAction = "start" | "down" | "up" | "first" | "last" | "end";

export type TabVisualDeps = {
  tabs_in_window: (window_id: number) => Promise<VisualTab[]>;
  collapsed_group_ids: (window_id: number) => Promise<ReadonlySet<number>>;
  // How many tabs of the window Firefox shows as selected.
  highlighted_count: (window_id: number) => Promise<number>;
  // Tab indexes, the first one active. Listing the active tab first keeps Firefox from switching tabs.
  highlight: (window_id: number, indexes: number[]) => Promise<void>;
  read_record: (window_id: number) => Promise<RangeRecord | undefined>;
  write_record: (window_id: number, record: RangeRecord) => Promise<void>;
  remove_record: (window_id: number) => Promise<void>;
};

// Strip order without the tabs Firefox's own range skips: hidden tabs and tabs of a collapsed group. The active tab always counts.
export function visible_order(tabs: readonly VisualTab[], collapsed_groups: ReadonlySet<number>): VisualTab[] {
  return tabs.filter((tab) => tab.active || (!tab.hidden && !collapsed_groups.has(tab.group_id))).toSorted((a, b) => a.index - b.index);
}

// Moves are clamped at the ends. A cursor that left the order (closed, hidden) restarts from the anchor.
export function moved_cursor(order: readonly VisualTab[], record: RangeRecord, action: "down" | "up" | "first" | "last", count: number): number {
  const at = (id: number) => order.findIndex((tab) => tab.id === id);
  const from = at(record.cursor) >= 0 ? at(record.cursor) : at(record.anchor);
  const target = action === "first" ? 0 : action === "last" ? order.length - 1 : from + (action === "down" ? count : -count);
  return order[Math.min(order.length - 1, Math.max(0, target))]!.id;
}

// The tabs between the two ends, ends included, in strip order.
export function range_between(order: readonly VisualTab[], anchor: number, cursor: number): VisualTab[] {
  const ends = [anchor, cursor].map((id) => order.findIndex((tab) => tab.id === id)).toSorted((a, b) => a - b);
  return order.slice(ends[0]!, ends[1]! + 1);
}

export function highlight_indexes(active_index: number, range: readonly VisualTab[]): number[] {
  return [active_index, ...range.map((tab) => tab.index).filter((index) => index !== active_index).toSorted((a, b) => a - b)];
}

export function make_tab_visual_handler(deps: TabVisualDeps) {
  const in_turn = create_write_queue();

  async function read_window(window_id: number) {
    const tabs = await deps.tabs_in_window(window_id);
    const active = tabs.find((tab) => tab.active);
    if (!active) throw new RuntimeRefusal("no active tab");
    return { active, order: visible_order(tabs, await deps.collapsed_group_ids(window_id)) };
  }

  const start = async (window_id: number) => {
    const { active, order } = await read_window(window_id);
    if (order.length < 2) throw new RuntimeRefusal("Only one tab to select");
    await deps.write_record(window_id, { anchor: active.id, cursor: active.id });
  };

  const move = async (window_id: number, action: "down" | "up" | "first" | "last", count: number) => {
    const { active, order } = await read_window(window_id);
    const stored = await deps.read_record(window_id);
    // A record whose anchor is not the active tab is stale: the range starts again at the active tab.
    const record = stored && stored.anchor === active.id ? stored : { anchor: active.id, cursor: active.id };
    const cursor = moved_cursor(order, record, action, count);
    await deps.write_record(window_id, { anchor: active.id, cursor });
    await deps.highlight(window_id, highlight_indexes(active.index, range_between(order, active.id, cursor)));
  };

  // The reset only runs while the active tab is still the anchor. A key that switches tabs right after the leave step must not be undone by a late reset, and Firefox clears the selection itself on a plain switch. The active tab is read last, just before the highlight. A mouse selection with no record stays.
  const end = async (window_id: number) => {
    const record = await deps.read_record(window_id);
    if (!record) return;
    await deps.remove_record(window_id);
    if ((await deps.highlighted_count(window_id)) < 2) return;
    const active = (await deps.tabs_in_window(window_id)).find((tab) => tab.active);
    if (active?.id === record.anchor) await deps.highlight(window_id, [active.index]);
  };

  return {
    run: (window_id: number, args: { action: VisualAction; count?: number }): Promise<void> =>
      in_turn(() => (args.action === "start" ? start(window_id) : args.action === "end" ? end(window_id) : move(window_id, args.action, args.count ?? 1))),
    // Settles when every move queued before this call has set the selection, so an action key typed right after a motion sees its range.
    idle: (): Promise<void> => in_turn(async () => {}),
    forget_window: (window_id: number): Promise<void> => in_turn(() => deps.remove_record(window_id)),
  };
}

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// `storage` is a getter because the command module is imported where `browser` does not exist (the docs and the commands.json build).
export function session_record_store(session: () => SessionStorage): Pick<TabVisualDeps, "read_record" | "write_record" | "remove_record"> {
  const key_of = (window_id: number) => TAB_VISUAL_STORAGE_PREFIX + window_id;
  const storage = { get: (key: string) => session().get(key), set: (items: Record<string, unknown>) => session().set(items), remove: (key: string) => session().remove(key) };
  return {
    read_record: async (window_id) => {
      const stored = (await storage.get(key_of(window_id)))[key_of(window_id)] as Partial<RangeRecord> | undefined;
      return typeof stored?.anchor === "number" && typeof stored.cursor === "number" ? { anchor: stored.anchor, cursor: stored.cursor } : undefined;
    },
    write_record: (window_id, record) => storage.set({ [key_of(window_id)]: record }),
    remove_record: (window_id) => storage.remove(key_of(window_id)),
  };
}
