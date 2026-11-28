// The tab range of tab visual mode. Firefox's own multiselection is the display: the active tab is always in it, so the anchor is the
// active tab and only the cursor end moves. The record `{ anchor, cursor }` per window lives in `storage.session`.

import { TAB_VISUAL_STORAGE_PREFIX } from "../shared/config/storage_keys.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { keep_chain } from "../shared/swallow.ts";
import { create_write_queue } from "./store_turns.ts";

export type VisualTab = { id: number; index: number; active: boolean; highlighted: boolean; hidden: boolean; group_id: number };
export type RangeRecord = { anchor: number; cursor: number };
export type VisualAction = "start" | "down" | "up" | "first" | "last" | "end";

export type TabVisualDeps = {
  tabs_in_window: (window_id: number) => Promise<VisualTab[]>;
  collapsed_group_ids: (window_id: number) => Promise<ReadonlySet<number>>;
  // Adds one tab to the selection or takes it out, and never makes it the active tab.
  set_highlighted: (tab_id: number, highlighted: boolean) => Promise<void>;
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

// The longest an action waits for the moves before it. A noted run can sit behind a macro replay or a prompt, and the action must still run.
export const ACTION_WAIT_MS = 2000;

type NotedRun = { tab_id: number; settled: Promise<void>; settle: () => void };

export function make_tab_visual_handler(deps: TabVisualDeps, action_wait_ms = ACTION_WAIT_MS) {
  const in_turn = create_write_queue();
  // The runs of `tab.visual` the background has received and whose move has not finished, oldest first. An action waits for those of its own tab, so it sees every move its page sent before it, however many steps each message takes on its way to the handler.
  // An entry settles when a move of its tab finishes or its run answers, whichever comes first. A later step of the run (a snippet that runs `tab.act`, a prompt) then holds no action.
  const noted: NotedRun[] = [];
  const note = (tab_id: number): NotedRun => {
    let resolve!: () => void;
    const settled = new Promise<void>((done) => (resolve = done));
    const entry: NotedRun = {
      tab_id,
      settled,
      settle: () => {
        const at = noted.indexOf(entry);
        if (at >= 0) noted.splice(at, 1);
        resolve();
      },
    };
    noted.push(entry);
    return entry;
  };

  async function read_window(window_id: number) {
    const tabs = await deps.tabs_in_window(window_id);
    const active = tabs.find((tab) => tab.active);
    if (!active) throw new RuntimeRefusal("no active tab");
    return { tabs, active, order: visible_order(tabs, await deps.collapsed_group_ids(window_id)) };
  }

  // One tab at a time, and never the active tab. `tabs.highlight` sets the whole selection and makes its first tab active, so a tab switch that lands between the read and the call would be undone. Taking the active tab out would switch tabs too.
  const select_only = (tabs: readonly VisualTab[], wanted: ReadonlySet<number>) =>
    Promise.all(tabs.filter((tab) => !tab.active && tab.highlighted !== wanted.has(tab.id)).map((tab) => deps.set_highlighted(tab.id, !tab.highlighted)));

  // A selection made with the mouse goes: the range starts at the active tab alone.
  const start = async (window_id: number) => {
    const { tabs, active, order } = await read_window(window_id);
    if (order.length < 2) throw new RuntimeRefusal("Only one tab to select");
    await deps.write_record(window_id, { anchor: active.id, cursor: active.id });
    await select_only(tabs, new Set());
  };

  // Only `start` begins a range. A move with no record, or after a tab switch, is a late key or a typed command in normal mode, and does nothing.
  const move = async (window_id: number, action: "down" | "up" | "first" | "last", count: number) => {
    const { tabs, active, order } = await read_window(window_id);
    const record = await deps.read_record(window_id);
    if (record?.anchor !== active.id) return;
    const cursor = moved_cursor(order, record, action, count);
    await deps.write_record(window_id, { anchor: active.id, cursor });
    await select_only(tabs, new Set(range_between(order, active.id, cursor).map((tab) => tab.id)));
  };

  // A mouse selection with no record stays.
  const end = async (window_id: number) => {
    if (!(await deps.read_record(window_id))) return;
    await deps.remove_record(window_id);
    await select_only(await deps.tabs_in_window(window_id), new Set());
  };

  return {
    // `tab_id` is the tab the move came from, which settles its oldest noted run.
    run: (window_id: number, args: { action: VisualAction; count?: number }, tab_id?: number): Promise<void> => {
      const turn = in_turn(() => (args.action === "start" ? start(window_id) : args.action === "end" ? end(window_id) : move(window_id, args.action, args.count ?? 1)));
      if (tab_id !== undefined) void keep_chain(turn).then(() => noted.find((entry) => entry.tab_id === tab_id)?.settle());
      return turn;
    },
    // Called as the run message arrives, with the sender's tab and the run's answer.
    received: (tab_id: number, answer: Promise<unknown>): void => {
      const entry = note(tab_id);
      void keep_chain(answer).then(entry.settle);
    },
    idle: async (tab_id: number | undefined): Promise<void> => {
      const own = noted.filter((entry) => entry.tab_id === tab_id).map((entry) => entry.settled);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.all(own), new Promise<void>((done) => (timer = setTimeout(done, action_wait_ms)))]);
      clearTimeout(timer);
      await in_turn(async () => {});
    },
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
