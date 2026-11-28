import { define } from "../shared/registry/builtin.ts";
import { browser_tab_split_deps, focus_other_pane, swap_panes } from "../background/tab_split.ts";
import { browser_module_call } from "../background/browser_module_call.ts";
import type { ModuleArgs } from "../shared/browser_module_protocol.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { MAX_RESIZE_STEPS, PANE_DIRECTIONS, PANE_REGIONS } from "../shared/browser_module_protocol.ts";
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

async function pane_call(kind: string, args: ModuleArgs = {}): Promise<void> {
  const result = await browser_module_call.call(kind, args);
  if (!result.ok) throw new RuntimeRefusal(result.error);
}

// The pane commands below change the window, which only the browser module can do. Each refuses with "Needs the browser module" when the module is absent or off, and with the module's own text when it cannot do the call.
define("pane.split", {
  label: "Split view",
  intent: "Split the window with a new tab or with the next tab. Needs the browser module.",
  params: [{ name: "with", type: "enum", values: ["new", "next"], default: "new", value_labels: { next: "with the next tab" }, description: { next: "Split with the tab after this one, and open no new tab." } }],
  bridge: false,
  runs_in: "background",
  run: (_ctx, args) => pane_call(args.with === "next" ? "pane.split_next_tab" : "pane.split_new_tab"),
});

define("pane.unsplit", {
  label: "Unsplit",
  intent: "End the split view the tab is in and keep both tabs. Needs the browser module.",
  bridge: false,
  runs_in: "background",
  run: () => pane_call("pane.unsplit"),
});

define("pane.close_both", {
  label: "Close both panes",
  intent: "Close both tabs of the split view the tab is in. Needs the browser module.",
  bridge: false,
  runs_in: "background",
  run: () => pane_call("pane.close_both"),
});

define("pane.resize", {
  label: "Resize pane",
  intent: "Resize the left pane of the split view. Each step is 5 percent. A count multiplies the steps. Needs the browser module.",
  params: [
    { name: "direction", type: "enum", values: ["widen", "narrow"], default: "widen", value_labels: { narrow: "narrower" }, description: { narrow: "Make the left pane narrower." } },
    { name: "steps", type: "int", default: 1, min: 1, max: MAX_RESIZE_STEPS, description: "Move the splitter this many steps." },
  ],
  bridge: false,
  runs_in: "background",
  count: { param: "steps" },
  run: (_ctx, args) => pane_call("pane.resize", { steps: args.direction === "narrow" ? -args.steps : args.steps }),
});

define("pane.focus", {
  label: "Focus region",
  intent: "Move the focus to the sidebar, page, other pane or DevTools. Needs the browser module.",
  params: [{ name: "region", type: "enum", values: PANE_REGIONS, value_labels: { devtools: "DevTools" }, description: { sidebar: "Focus the sidebar.", page: "Focus the page.", split: "Focus the other pane of the split view.", devtools: "Focus the docked DevTools." } }],
  bridge: false,
  runs_in: "background",
  run: (_ctx, args) => pane_call("pane.focus_region", { region: args.region }),
});

define("pane.equalize", {
  label: "Equal panes",
  intent: "Give the two panes of the split view equal widths. Needs the browser module.",
  bridge: false,
  runs_in: "background",
  run: () => pane_call("pane.equalize"),
});

define("pane.focus_side", {
  label: "Focus left or right",
  intent: "Focus the other pane, then DevTools, then the sidebar there. Needs the browser module.",
  params: [{ name: "direction", type: "enum", values: PANE_DIRECTIONS, description: { left: "Focus what is on the left.", right: "Focus what is on the right." } }],
  bridge: false,
  runs_in: "background",
  run: (_ctx, args) => pane_call("pane.focus_direction", { direction: args.direction }),
});
