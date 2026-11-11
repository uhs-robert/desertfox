import { define } from "../shared/registry/builtin.ts";
import { WHERE_PARAM } from "./open_target.ts";
import { YANK_REGISTER_PARAM } from "./register_param.ts";

define("visual.act", {
  completion: ["visual", "visual_line"],
  label: "Act on selection",
  intent: "Copy the selection, swap its ends or search for it.",
  params: [{ name: "action", type: "enum", values: ["yank", "swap", "search"], value_labels: { yank: "to copy", swap: "to swap ends", search: "to search" }, description: { yank: "Copy the selection.", swap: "Swap the ends of the selection.", search: "Search for the selection." } }, YANK_REGISTER_PARAM],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  modes: ["visual", "visual_line"],
  bundle: "caret",
});

define("visual.object", {
  completion: ["visual", "visual_line"],
  label: "Select a text object",
  intent: "Select the word or sentence at the caret, or grow it.",
  params: [
    { name: "object", type: "enum", values: ["word", "sentence"], value_labels: { word: "a word", sentence: "a sentence" }, description: { word: "Select a word.", sentence: "Select a sentence." } },
    { name: "scope", type: "enum", values: ["around", "inner"], default: "around", value_labels: { inner: "without the space" }, description: { inner: "Leave out the space beside it." } },
  ],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  modes: ["visual", "visual_line"],
  bundle: "caret",
});

define("visual.open", {
  completion: ["visual", "visual_line"],
  label: "Open the selection",
  intent: "Open the selected text as a URL, or search for it.",
  params: [WHERE_PARAM],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  modes: ["visual", "visual_line"],
  bundle: "caret",
});
