// Split view: the two tabs of a window that Firefox shows side by side. The extension cannot create or end a split, so these only move within one.
import { RuntimeRefusal } from "../shared/command.ts";
import { ignore_refusal } from "../shared/swallow.ts";

export type SplitTab = { id: number; index: number; split_id: number };

export type TabSplitDeps = {
  // The tabs of the window that holds the tab, empty when the tab is gone.
  window_tabs_of: (tab_id: number) => Promise<SplitTab[]>;
  activate: (tab_id: number) => Promise<void>;
  move: (tab_id: number, index: number) => Promise<void>;
};

export const NOT_IN_SPLIT = "This tab is not in a split view";

// The other tab of the split view that holds `tab_id`.
async function pair_of(deps: TabSplitDeps, tab_id: number): Promise<{ current: SplitTab; other: SplitTab }> {
  const tabs = await deps.window_tabs_of(tab_id);
  const current = tabs.find((tab) => tab.id === tab_id);
  if (!current) throw new RuntimeRefusal("the active tab is gone");
  const other = current.split_id === -1 ? undefined : tabs.find((tab) => tab.split_id === current.split_id && tab.id !== tab_id);
  if (!other) throw new RuntimeRefusal(NOT_IN_SPLIT);
  return { current, other };
}

export async function focus_other_pane(deps: TabSplitDeps, tab_id: number): Promise<void> {
  await deps.activate((await pair_of(deps, tab_id)).other.id);
}

// Firefox has no swap call. Moving a tab onto its partner's place trades the two and keeps the split (measured in Firefox 160).
export async function swap_panes(deps: TabSplitDeps, tab_id: number): Promise<void> {
  const { current, other } = await pair_of(deps, tab_id);
  await deps.move(other.id, current.index);
}

export const browser_tab_split_deps: TabSplitDeps = {
  window_tabs_of: async (tab_id) => {
    const tab = await ignore_refusal(browser.tabs.get(tab_id));
    if (tab?.windowId === undefined) return [];
    return (await browser.tabs.query({ windowId: tab.windowId })).map((tab) => ({ id: tab.id!, index: tab.index, split_id: tab.splitViewId ?? -1 }));
  },
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  move: async (tab_id, index) => void (await browser.tabs.move(tab_id, { index })),
};
