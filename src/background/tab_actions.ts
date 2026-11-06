// The one place that mutes, pins, moves and reopens tabs. Callers choose the ids: the tab commands now, the tab list
// selection later. Each function takes a list, and a single tab is a list of one.

export type TabActionDeps = {
  set_muted: (tab_ids: number[], muted: boolean) => Promise<void>;
  set_pinned: (tab_ids: number[], pinned: boolean) => Promise<void>;
  // The tabs keep their given order and end side by side, the first at `index`.
  move: (tab_ids: number[], index: number) => Promise<void>;
  // `active` is true when left out.
  open_tab: (open: { window_id: number; url: string; index: number; pinned: boolean; cookie_store_id: string; active?: boolean }) => Promise<void>;
  remove: (tab_ids: number[]) => Promise<void>;
};

export type ReopenTab = { id: number; index: number; pinned: boolean; url: string | undefined; cookie_store_id?: string | undefined };

export async function set_muted(deps: Pick<TabActionDeps, "set_muted">, tab_ids: number[], muted: boolean): Promise<void> {
  if (tab_ids.length > 0) await deps.set_muted(tab_ids, muted);
}

export async function set_pinned(deps: Pick<TabActionDeps, "set_pinned">, tab_ids: number[], pinned: boolean): Promise<void> {
  if (tab_ids.length > 0) await deps.set_pinned(tab_ids, pinned);
}

// Each tab closes on its own, so one that closed since the caller chose its id does not stop the rest. Returns how many closed.
export async function close_tabs(deps: Pick<TabActionDeps, "remove">, tab_ids: number[]): Promise<number> {
  const results = await Promise.allSettled(tab_ids.map((id) => deps.remove([id])));
  return results.filter((result) => result.status === "fulfilled").length;
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

// The tab list's many-tab reopen, each tab in its own window. Unlike `reopen_in_container`, a tab that fails to reopen is skipped and the
// rest go on, and a tab already in the container stays. No new tab becomes active: the line lives in the active tab, and hiding that tab
// ends the line. Returns the ids that reopened.
export async function reopen_tabs_in_container(
  deps: Pick<TabActionDeps, "open_tab" | "remove">,
  tabs: (ReopenTab & { window_id: number })[],
  cookie_store_id: string,
): Promise<number[]> {
  const open_tab: TabActionDeps["open_tab"] = (open) => deps.open_tab({ ...open, active: false });
  const reopened: number[] = [];
  for (const tab of tabs.filter((candidate) => candidate.cookie_store_id !== cookie_store_id).toSorted((a, b) => a.index - b.index)) {
    reopened.push(...(await reopen_in_container({ open_tab, remove: deps.remove }, tab.window_id, [tab], cookie_store_id).catch((): number[] => [])));
  }
  return reopened;
}

export const browser_tab_action_deps: TabActionDeps = {
  set_muted: async (tab_ids, muted) => void (await Promise.all(tab_ids.map((id) => browser.tabs.update(id, { muted })))),
  set_pinned: async (tab_ids, pinned) => void (await Promise.all(tab_ids.map((id) => browser.tabs.update(id, { pinned })))),
  move: async (tab_ids, index) => void (await browser.tabs.move(tab_ids, { index })),
  open_tab: async ({ window_id, url, index, pinned, cookie_store_id, active = true }) => {
    await browser.tabs.create({ windowId: window_id, url, index, pinned, cookieStoreId: cookie_store_id, active });
  },
  remove: (tab_ids) => browser.tabs.remove(tab_ids),
};
