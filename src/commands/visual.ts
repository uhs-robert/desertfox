import { visual_act } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";

define("visual.act", {
  completion: ["visual", "visual_line"],
  label: "Act on selection",
  intent: "Copy the selection, swap its ends or search for it.",
  params: [{ name: "action", type: "enum", values: ["yank", "swap", "search"], value_labels: { yank: "to copy", swap: "to swap ends", search: "to search" } }],
  runs_in: "content",
  modes: ["visual", "visual_line"],
  run: visual_act.run,
});
