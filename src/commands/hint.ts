import { hint_run } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";
import { WHERE, WHERE_SHORT } from "./open_target.ts";

define("hint.run", {
  name: "hint",
  label: "Hint",
  intent: "Label the elements on the page with keys, then act on the one you pick: open it here, in a tab, in a background tab or in a window, copy its address or its text, delete it or focus it. Rapid keeps hint mode open for more picks. Text keeps only the links whose text holds it.",
  params: [
    {
      name: "action",
      type: "enum",
      values: [...WHERE, "select", "copy", "copy_text", "delete", "focus"],
      default: "here",
      short: { ...WHERE_SHORT, select: "s", copy: "y", copy_text: "Y", delete: "d", focus: "f" },
      value_labels: {
        tab: "in new tab",
        background: "in background tab",
        window: "in new window",
        select: "to select",
        copy: "to copy",
        copy_text: "to copy text",
        delete: "to delete",
        focus: "to focus",
      },
    },
    {
      name: "filter",
      type: "enum",
      values: ["all", "clickable", "inputs", "links", "custom"],
      default: "clickable",
      short: { all: "a", inputs: "i", links: "l", custom: "u" },
      value_labels: { all: "for all elements", inputs: "for inputs", links: "for links", custom: "for a selector" },
    },
    { name: "selector", type: "string", when: { filter: ["custom"] } },
    { name: "text", type: "string", default: "" },
    { name: "rapid", type: "bool", default: false, short: "r" },
  ],
  runs_in: "content",
  run: hint_run.run,
});
