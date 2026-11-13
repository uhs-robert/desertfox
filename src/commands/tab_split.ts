import { define } from "../shared/registry/builtin.ts";
import { browser_tab_split_deps, focus_other_pane, swap_panes } from "../background/tab_split.ts";
import { require_tab_id } from "./open_target.ts";

define("tab.split_other", {
  label: "Other pane",
  intent: "Move focus to the other tab of the split view the tab is in.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => focus_other_pane(browser_tab_split_deps, require_tab_id(ctx)),
});

define("tab.split_swap", {
  label: "Swap panes",
  intent: "Swap the two tabs of the split view the tab is in.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => swap_panes(browser_tab_split_deps, require_tab_id(ctx)),
});
