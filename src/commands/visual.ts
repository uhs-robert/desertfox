import { define } from "../shared/registry/builtin.ts";
import { YANK_REGISTER_PARAM } from "./register_param.ts";

define("visual.act", {
  completion: ["visual", "visual_line"],
  label: "Act on selection",
  intent: "Copy the selection, swap its ends or search for it.",
  params: [{ name: "action", type: "enum", values: ["yank", "swap", "search"], value_labels: { yank: "to copy", swap: "to swap ends", search: "to search" }, description: { yank: "Copy the selection.", swap: "Swap the ends of the selection.", search: "Search for the selection." } }, YANK_REGISTER_PARAM],
  runs_in: "content",
  repeatable: false,
  modes: ["visual", "visual_line"],
  bundle: "caret",
});
