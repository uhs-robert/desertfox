// The tab the user was on before the current one, across every window: where `tab.alternate_any_window` goes. `previous_tab.ts` keeps the same record per window.
// Normal and private windows keep separate records, so the command never crosses into or out of a private window, as the tab list never does.

import { ignore_refusal } from "../shared/swallow.ts";
import { LAST_USED_TAB_STORAGE_KEY } from "./storage_keys.ts";
import { create_write_queue } from "./store_turns.ts";

type UsedTabs = { current: number | undefined; previous: number | undefined };
type LastUsedRecord = { focused_window_id: number | undefined; normal: UsedTabs; private: UsedTabs };

export type LastUsedTabDeps = {
  storage: Pick<typeof browser.storage.session, "get" | "set">;
  // Undefined when the window is gone.
  active_tab_of: (window_id: number) => Promise<{ tab_id: number; incognito: boolean } | undefined>;
  // Undefined when the tab is gone.
  is_private: (tab_id: number) => Promise<boolean | undefined>;
};

// `windows.onFocusChanged` reports this id when focus leaves every Firefox window.
const NO_WINDOW = -1;

const number_or_none = (value: unknown) => (typeof value === "number" ? value : undefined);
const used_tabs_from = (stored: unknown): UsedTabs => {
  const { current, previous } = (stored ?? {}) as Record<string, unknown>;
  return { current: number_or_none(current), previous: number_or_none(previous) };
};

const privacy_slot = (incognito: boolean) => (incognito ? "private" : "normal");

// The same tab twice in a row is one switch reported by two events (`onActivated` and `onFocusChanged`), not a switch to itself.
function with_switch_to(record: LastUsedRecord, window_id: number, tab_id: number, incognito: boolean): LastUsedRecord {
  const used = record[privacy_slot(incognito)];
  const next = used.current === tab_id ? used : { current: tab_id, previous: used.current };
  return { ...record, focused_window_id: window_id, [privacy_slot(incognito)]: next };
}

const without_tab = (used: UsedTabs, tab_id: number): UsedTabs => ({
  current: used.current === tab_id ? undefined : used.current,
  previous: used.previous === tab_id ? undefined : used.previous,
});

export function create_last_used_tabs(deps: LastUsedTabDeps) {
  const read = async (): Promise<LastUsedRecord> => {
    const stored = ((await deps.storage.get(LAST_USED_TAB_STORAGE_KEY))[LAST_USED_TAB_STORAGE_KEY] ?? {}) as Record<string, unknown>;
    return { focused_window_id: number_or_none(stored.focused_window_id), normal: used_tabs_from(stored.normal), private: used_tabs_from(stored.private) };
  };
  // Updates run one after another, so the two events of one switch cannot overwrite each other's read.
  const run_in_turn = create_write_queue();
  let settled: Promise<void> = Promise.resolve();
  // A failed write warns and keeps the old record, and the next update still runs.
  const update = (change: (record: LastUsedRecord) => Promise<LastUsedRecord>) => {
    settled = run_in_turn(async () => deps.storage.set({ [LAST_USED_TAB_STORAGE_KEY]: await change(await read()) })).catch((error: unknown) =>
      console.warn("desertfox: could not save the last used tab", error),
    );
    return settled;
  };
  return {
    // Waits for queued updates, so a read right after a switch sees it.
    previous_of: async (incognito: boolean): Promise<number | undefined> => {
      await settled;
      return (await read())[privacy_slot(incognito)].previous;
    },
    // A tab activated in a window without focus is not one the user looked at. If that window gains focus later, `focused` records it.
    activated: (tab_id: number, window_id: number): Promise<void> =>
      update(async (record) => {
        if (record.focused_window_id !== undefined && record.focused_window_id !== window_id) return record;
        const incognito = await deps.is_private(tab_id);
        return incognito === undefined ? record : with_switch_to(record, window_id, tab_id, incognito);
      }),
    // Focus leaving Firefox keeps the record, so coming back to the same tab is no switch.
    focused: (window_id: number): Promise<void> =>
      window_id === NO_WINDOW
        ? settled
        : update(async (record) => {
            const active = await deps.active_tab_of(window_id);
            return active ? with_switch_to(record, window_id, active.tab_id, active.incognito) : record;
          }),
    removed: (tab_id: number): Promise<void> => update(async (record) => ({ ...record, normal: without_tab(record.normal, tab_id), private: without_tab(record.private, tab_id) })),
    // The next focus event names the new window. Until then, an activation in any window counts.
    window_removed: (window_id: number): Promise<void> =>
      update(async (record) => (record.focused_window_id === window_id ? { ...record, focused_window_id: undefined } : record)),
  };
}

// One instance serves the listeners and the command, so a read right after a switch waits on that switch's write.
let shared: ReturnType<typeof create_last_used_tabs> | undefined;
export function shared_last_used_tabs() {
  return (shared ??= create_last_used_tabs({
    storage: browser.storage.session,
    active_tab_of: async (window_id) => {
      const [active] = (await ignore_refusal(browser.tabs.query({ windowId: window_id, active: true }))) ?? [];
      return active?.id === undefined ? undefined : { tab_id: active.id, incognito: active.incognito };
    },
    is_private: async (tab_id) => (await ignore_refusal(browser.tabs.get(tab_id)))?.incognito,
  }));
}
