import { RuntimeRefusal } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { make_tab_visual_handler, session_record_store } from "../background/tab_visual.ts";
import type { TabVisualDeps } from "../background/tab_visual.ts";

const tab_visual_deps: TabVisualDeps = {
  tabs_in_window: async (window_id) => (await browser.tabs.query({ windowId: window_id })).map((tab) => ({ id: tab.id!, index: tab.index, active: tab.active, hidden: !!tab.hidden, group_id: tab.groupId ?? -1 })),
  collapsed_group_ids: async (window_id) => new Set((await browser.tabGroups.query({ windowId: window_id, collapsed: true })).map((group) => group.id)),
  highlighted_count: async (window_id) => (await browser.tabs.query({ windowId: window_id, highlighted: true })).length,
  highlight: async (window_id, indexes) => void (await browser.tabs.highlight({ windowId: window_id, tabs: indexes })),
  ...session_record_store(() => browser.storage.session),
};

export const tab_visual = make_tab_visual_handler(tab_visual_deps);

const require_window_id = (window_id: number | undefined): number => {
  if (window_id === undefined) throw new RuntimeRefusal("No window");
  return window_id;
};

define("tab.visual", {
  completion: "hidden",
  label: "Select a range of tabs",
  intent: "Move the tab range. Firefox shows it as selected tabs. Start makes the active tab the anchor. Down, up, first and last move the other end through the tabs of the strip in order, and skip hidden tabs and tabs of a collapsed group. A count prefix moves that many tabs. End clears the range back to the active tab.",
  params: [
    {
      name: "action",
      type: "enum",
      values: ["start", "down", "up", "first", "last", "end"],
      value_labels: { start: "to start the range", down: "to the next tab", up: "to the previous tab", first: "to the first tab", last: "to the last tab", end: "to end the range" },
      description: { start: "Anchor the range at the active tab.", down: "Extend to the next tab.", up: "Extend to the previous tab.", first: "Extend to the first tab.", last: "Extend to the last tab.", end: "Clear the range to the active tab." },
    },
    { name: "count", type: "int", min: 1, default: 1, when: { action: ["down", "up"] }, description: "Move this many tabs." },
  ],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  count: { param: "count" },
  modes: ["normal", "tab_visual"],
  run: (ctx, args) => tab_visual.run(require_window_id(ctx.window_id), args),
});

// The second step of `gv`. It runs in the page, so the bundle with the mode's sink loads before the mode is set.
define("tab.visual_enter", {
  completion: "hidden",
  label: "Show the tab range mode",
  intent: "Switch the page to tab range mode. It follows tab.visual start.",
  bridge: false,
  runs_in: "content",
  bundle: "tab_visual",
  repeatable: false,
  modes: ["normal"],
});
