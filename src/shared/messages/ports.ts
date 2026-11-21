// Messages on the long-lived ports: the devtools page and the tab model.

export type DevtoolsHello = {
  type: "devtools_hello";
  tab_id: number;
};

// From the background to a devtools page, on its port: select the pick now on the page.
export type DevtoolsPick = {
  type: "devtools_pick";
};

// From an extension page (the settings page, the popup): sets or resets one setting. `value` is the typed value, checked by the setting's own check. `layer` defaults to `saved`, which a set reaches only for a consent setting. A reset drops the saved and the temp edit.

export type TabRow = {
  id: number;
  window_id: number;
  index: number;
  title: string;
  url: string;
  favicon_url: string;
  site: string;
  pinned: boolean;
  muted: boolean;
  audible: boolean;
  discarded: boolean;
  active: boolean;
  // The tab the window was on before its current one, the tab list's `#`. Never the active tab.
  previous: boolean;
  // The window's place in `windows.getAll`, from 1, as `tab.attach` and the `windows` list count. 0 for a popup.
  window_number: number;
  // The cookie store id, which a reopen needs. The name, color and icon are "" for the default container, for a private tab, for a deleted container and with containers off.
  container: string;
  container_name: string;
  container_color: string;
  container_icon: string;
  // The native tab group of the tab, -1 for none, as Firefox reports it. The group's own fields are in the groups table.
  group_id: number;
  // The split view of the tab, -1 for none, as Firefox reports it. The two tabs of a split view share one id.
  split_id: number;
};

// A native tab group. `color` is Firefox's own color name.
export type GroupRow = { id: number; window_id: number; title: string; color: string; collapsed: boolean };

// A patch names groups only when some changed. The group lists follow the same privacy rule as the tabs.
export type TabModelMessage =
  | { type: "snapshot"; rev: number; tabs: TabRow[]; groups: GroupRow[] }
  | { type: "patch"; rev: number; upserts: TabRow[]; removed: number[]; groups?: GroupRow[]; groups_removed?: number[] };
export type TabModelRequest = { type: "resync" };
