// The one place that mutes, pins, moves and reopens tabs. Callers choose the ids: the tab commands now, the tab list
// selection later. Each function takes a list, and a single tab is a list of one.

export type TabActionDeps = {
  set_muted: (tab_ids: number[], muted: boolean) => Promise<void>;
  set_pinned: (tab_ids: number[], pinned: boolean) => Promise<void>;
  // The tabs keep their given order and end side by side, the first at `index`.
  move: (tab_ids: number[], index: number) => Promise<void>;
  open_tab: (open: { window_id: number; url: string; index: number; pinned: boolean; cookie_store_id: string }) => Promise<void>;
  remove: (tab_ids: number[]) => Promise<void>;
};

export type ReopenTab = { id: number; index: number; pinned: boolean; url: string | undefined };

export async function set_muted(deps: Pick<TabActionDeps, "set_muted">, tab_ids: number[], muted: boolean): Promise<void> {
  if (tab_ids.length > 0) await deps.set_muted(tab_ids, muted);
}

export async function set_pinned(deps: Pick<TabActionDeps, "set_pinned">, tab_ids: number[], pinned: boolean): Promise<void> {
  if (tab_ids.length > 0) await deps.set_pinned(tab_ids, pinned);
}

export async function move_tabs(deps: Pick<TabActionDeps, "move">, tab_ids: number[], index: number): Promise<void> {
  if (tab_ids.length > 0) await deps.move(tab_ids, index);
}

// Each tab is its own unit, in tab bar order: the new tab opens at the old tab's place, then the old one closes, so
// places stay put and a failed open leaves no duplicate. The failure stops the run and reaches the caller, as for one
// tab. A tab with no address cannot reopen and stays. Returns the ids that reopened.
export async function reopen_in_container(
  deps: Pick<TabActionDeps, "open_tab" | "remove">,
  window_id: number,
  tabs: ReopenTab[],
  cookie_store_id: string,
): Promise<number[]> {
  const reopened: number[] = [];
  for (const tab of tabs.toSorted((a, b) => a.index - b.index)) {
    if (tab.url === undefined) continue;
    await deps.open_tab({ window_id, url: tab.url, index: tab.index, pinned: tab.pinned, cookie_store_id });
    await deps.remove([tab.id]);
    reopened.push(tab.id);
  }
  return reopened;
}

export const browser_tab_action_deps: TabActionDeps = {
  set_muted: async (tab_ids, muted) => void (await Promise.all(tab_ids.map((id) => browser.tabs.update(id, { muted })))),
  set_pinned: async (tab_ids, pinned) => void (await Promise.all(tab_ids.map((id) => browser.tabs.update(id, { pinned })))),
  move: async (tab_ids, index) => void (await browser.tabs.move(tab_ids, { index })),
  open_tab: async ({ window_id, url, index, pinned, cookie_store_id }) => {
    await browser.tabs.create({ windowId: window_id, url, index, pinned, cookieStoreId: cookie_store_id, active: true });
  },
  remove: (tab_ids) => browser.tabs.remove(tab_ids),
};
