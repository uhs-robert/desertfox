import { RuntimeRefusal } from "../shared/command.ts";
import { ignore_refusal, refused_as } from "../shared/swallow.ts";

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

// What the group actions read of a tab before they act. `group_id` is -1 for a tab in no group, as Firefox reports it.
export type GroupTabInfo = { id: number; window_id: number; pinned: boolean; group_id: number };
export type GroupProps = { title?: string; collapsed?: boolean; color?: browser.tabGroups.Color };

export type GroupDeps = {
  tab_infos: (tab_ids: number[]) => Promise<GroupTabInfo[]>;
  // The window of a group, or undefined when it is gone.
  group_window: (group_id: number) => Promise<number | undefined>;
  // Without `group_id` the tabs form a new group. Answers the group id.
  group: (tab_ids: number[], group_id: number | undefined) => Promise<number>;
  ungroup: (tab_ids: number[]) => Promise<void>;
  update_group: (group_id: number, props: GroupProps) => Promise<void>;
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
    reopened.push(...(await refused_as(reopen_in_container({ open_tab, remove: deps.remove }, tab.window_id, [tab], cookie_store_id), [] as number[])));
  }
  return reopened;
}

// Firefox allows no pinned tab in a group and keeps a group inside one window, so both cases fail here with a clear message instead of
// Firefox's own error or a silent move.
export async function group_tabs(deps: GroupDeps, tab_ids: number[], target?: { group_id?: number; title?: string }): Promise<number> {
  const infos = await deps.tab_infos(tab_ids);
  if (infos.some((info) => info.pinned)) throw new RuntimeRefusal("a pinned tab cannot join a group");
  const windows = new Set(infos.map((info) => info.window_id));
  if (windows.size > 1) throw new RuntimeRefusal("the tabs are in different windows, and a group stays in one window");
  if (target?.group_id !== undefined) {
    const group_window = await deps.group_window(target.group_id);
    if (group_window === undefined) throw new RuntimeRefusal("the group is gone");
    if (!windows.has(group_window)) throw new RuntimeRefusal("the group is in another window");
  }
  const group_id = await deps.group(tab_ids, target?.group_id);
  if (target?.group_id === undefined && target?.title) await deps.update_group(group_id, { title: target.title });
  return group_id;
}

export async function ungroup_tabs(deps: Pick<GroupDeps, "ungroup">, tab_ids: number[]): Promise<void> {
  if (tab_ids.length > 0) await deps.ungroup(tab_ids);
}

export async function set_group(deps: Pick<GroupDeps, "update_group">, group_id: number, props: GroupProps): Promise<void> {
  await deps.update_group(group_id, props);
}

export const browser_group_deps: GroupDeps = {
  tab_infos: async (tab_ids) => {
    const tabs = await Promise.all(tab_ids.map((id) => browser.tabs.get(id)));
    return tabs.map((tab) => ({ id: tab.id!, window_id: tab.windowId!, pinned: tab.pinned, group_id: tab.groupId ?? -1 }));
  },
  group_window: async (group_id) => (await ignore_refusal(browser.tabGroups.get(group_id)))?.windowId,
  group: (tab_ids, group_id) => browser.tabs.group({ tabIds: tab_ids, ...(group_id === undefined ? {} : { groupId: group_id }) }),
  ungroup: (tab_ids) => browser.tabs.ungroup(tab_ids),
  update_group: async (group_id, props) => void (await browser.tabGroups.update(group_id, props)),
};

export const browser_tab_action_deps: TabActionDeps = {
  set_muted: async (tab_ids, muted) => void (await Promise.all(tab_ids.map((id) => browser.tabs.update(id, { muted })))),
  set_pinned: async (tab_ids, pinned) => void (await Promise.all(tab_ids.map((id) => browser.tabs.update(id, { pinned })))),
  move: async (tab_ids, index) => void (await browser.tabs.move(tab_ids, { index })),
  open_tab: async ({ window_id, url, index, pinned, cookie_store_id, active = true }) => {
    await browser.tabs.create({ windowId: window_id, url, index, pinned, cookieStoreId: cookie_store_id, active });
  },
  remove: (tab_ids) => browser.tabs.remove(tab_ids),
};
