import { create_previous_tabs } from "./previous_tab.ts";

// The one place that unloads and loads tabs. Nothing else calls `tabs.discard`. Callers choose the ids: the tab
// commands, the command line row key and, later, a sidebar selection. This file owns the rules.

export type DiscardTab = { id: number; window_id: number; index: number; active: boolean; audible: boolean; discarded: boolean };

export type DiscardDeps = {
  read_tab: (tab_id: number) => Promise<DiscardTab | undefined>;
  // In tab bar order.
  tabs_in_window: (window_id: number) => Promise<DiscardTab[]>;
  alternate_of: (window_id: number) => Promise<number | undefined>;
  activate: (tab_id: number) => Promise<void>;
  // Firefox never rejects: on the active tab and on privileged pages it does nothing, so callers re-read `discarded`.
  discard: (tab_id: number) => Promise<void>;
  // Loads without activating, and keeps scroll and form data. `tabs.update` with a url would reset both.
  reload: (tab_id: number) => Promise<void>;
};

export type Skip = { id: number; reason: string };

export type SetUnloadedResult = { changed: number[]; skipped: Skip[] };

export type SetUnloadedOptions = {
  // This tab may be unloaded though it is active: focus moves to another loaded tab first. Any other active tab is skipped.
  leave_active?: number;
};

const NO_LOADED_TAB = "no other loaded tab to switch to";

// The alternate tab when it is loaded, else the first loaded tab after the current one, else the first loaded one before it.
function tab_to_switch_to(tabs: readonly DiscardTab[], current: DiscardTab, alternate_id: number | undefined, leaving: ReadonlySet<number>): number | undefined {
  const usable = (tab: DiscardTab) => !tab.discarded && !leaving.has(tab.id) && tab.id !== current.id;
  const alternate = tabs.find((tab) => tab.id === alternate_id);
  if (alternate && usable(alternate)) return alternate.id;
  return (tabs.find((tab) => tab.index > current.index && usable(tab)) ?? tabs.findLast((tab) => tab.index < current.index && usable(tab)))?.id;
}

export async function set_unloaded(deps: DiscardDeps, tab_ids: readonly number[], unloaded: boolean, options: SetUnloadedOptions = {}): Promise<SetUnloadedResult> {
  const skipped: Skip[] = [];
  const eligible: DiscardTab[] = [];
  for (const id of tab_ids) {
    const tab = await deps.read_tab(id);
    const reason = tab ? (unloaded ? unload_refusal(tab, options) : load_refusal(tab)) : "closed";
    if (reason || !tab) skipped.push({ id, reason: reason ?? "closed" });
    else eligible.push(tab);
  }
  const changed: number[] = [];
  if (!unloaded) {
    for (const tab of eligible) {
      await deps.reload(tab.id);
      if ((await deps.read_tab(tab.id))?.discarded === false) changed.push(tab.id);
      else skipped.push({ id: tab.id, reason: "still unloaded" });
    }
    return { changed, skipped };
  }
  const leaving_tab = eligible.find((tab) => tab.active);
  let switched = false;
  if (leaving_tab) {
    const destination = tab_to_switch_to(await deps.tabs_in_window(leaving_tab.window_id), leaving_tab, await deps.alternate_of(leaving_tab.window_id), new Set(eligible.map((tab) => tab.id)));
    if (destination === undefined) {
      skipped.push({ id: leaving_tab.id, reason: NO_LOADED_TAB });
      eligible.splice(eligible.indexOf(leaving_tab), 1);
    } else {
      await deps.activate(destination);
      switched = true;
    }
  }
  for (const tab of eligible) {
    await deps.discard(tab.id);
    // Firefox answers nothing when it declines, so the tab itself says whether it unloaded.
    if ((await deps.read_tab(tab.id))?.discarded) changed.push(tab.id);
    else {
      skipped.push({ id: tab.id, reason: "Firefox cannot unload this page" });
      // The user keeps the tab they were on.
      if (tab === leaving_tab && switched) await deps.activate(tab.id);
    }
  }
  return { changed, skipped };
}

function unload_refusal(tab: DiscardTab, options: SetUnloadedOptions): string | undefined {
  if (tab.discarded) return "already unloaded";
  if (tab.audible) return "audible";
  if (tab.active && tab.id !== options.leave_active) return "active in its window";
  return undefined;
}

const load_refusal = (tab: DiscardTab) => (tab.discarded ? undefined : "already loaded");

// "unloaded 3 tabs, skipped 1 (audible)". Equal reasons merge into one count.
export function describe_result(verb: "unloaded" | "loaded", result: SetUnloadedResult): string {
  const plural = (count: number) => `${count} ${count === 1 ? "tab" : "tabs"}`;
  const head = `${verb} ${plural(result.changed.length)}`;
  if (result.skipped.length === 0) return head;
  const counts = new Map<string, number>();
  for (const { reason } of result.skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const reasons = [...counts].map(([reason, count]) => (count === 1 ? reason : `${reason} x${count}`)).join(", ");
  return `${head}, skipped ${result.skipped.length} (${reasons})`;
}

function to_discard_tab(tab: browser.tabs.Tab): DiscardTab {
  return { id: tab.id ?? -1, window_id: tab.windowId ?? -1, index: tab.index, active: tab.active, audible: tab.audible ?? false, discarded: tab.discarded ?? false };
}

// The alternate tab is read through a second reader of the same storage. A write still queued in the first reader may not show yet.
export const browser_discard_deps: DiscardDeps = {
  read_tab: async (tab_id) => {
    const tab = await browser.tabs.get(tab_id).catch(() => undefined);
    return tab && to_discard_tab(tab);
  },
  tabs_in_window: async (window_id) => (await browser.tabs.query({ windowId: window_id })).map(to_discard_tab).sort((a, b) => a.index - b.index),
  alternate_of: (window_id) => create_previous_tabs(browser.storage.session).previous_of(window_id),
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  discard: async (tab_id) => void (await browser.tabs.discard(tab_id)),
  reload: (tab_id) => browser.tabs.reload(tab_id),
};

