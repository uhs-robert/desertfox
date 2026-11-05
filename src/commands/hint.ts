import { hint_run } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";
import { WHERE, WHERE_SHORT } from "./open_target.ts";

define("hint.run", {
  name: "hint",
  label: "Hint",
  intent: "Pick a page element by key and act on it. It labels the elements on the page with keys, then acts on the one you pick: open it here, in a tab, in a background tab or in a window, copy its address or its text, delete it or focus it. Caret and visual start caret mode or visual mode at the element. Rapid keeps hint mode open for more picks. Text keeps only the links whose text holds it.",
  params: [
    {
      name: "action",
      type: "enum",
      values: [...WHERE, "caret", "visual", "copy", "copy_text", "delete", "focus"],
      default: "here",
      short: { ...WHERE_SHORT, caret: "c", visual: "v", copy: "y", copy_text: "Y", delete: "d", focus: "f" },
      value_labels: {
        tab: "in new tab",
        background: "in background tab",
        window: "in new window",
        caret: "to start the caret",
        visual: "to start visual mode",
        copy: "to copy",
        copy_text: "to copy text",
        delete: "to delete",
        focus: "to focus",
      },
      description: {
        tab: "Open the element in a new tab.",
        background: "Open the element in a background tab.",
        window: "Open the element in a new window.",
        caret: "Start caret mode at the element or the next text.",
        visual: "Start visual mode at the element or the next text.",
        copy: "Copy the address of the element.",
        copy_text: "Copy the text of the element.",
        delete: "Delete the element from the page.",
        focus: "Focus the element.",
      },
    },
    {
      name: "filter",
      type: "enum",
      values: ["all", "clickable", "buttons", "inputs", "links", "prose", "scrollable", "custom"],
      default: "clickable",
      short: { all: "a", buttons: "B", inputs: "i", links: "l", prose: "p", scrollable: "s", custom: "u" },
      value_labels: { all: "for all elements", buttons: "for buttons", inputs: "for inputs", links: "for links", prose: "for text", scrollable: "for scroll boxes", custom: "for a selector" },
      description: {
        all: "Label every element.",
        buttons: "Label only the buttons.",
        inputs: "Label only the inputs.",
        links: "Label only the links.",
        prose: "Label the elements that hold text of their own.",
        scrollable: "Label the boxes that scroll, to focus one.",
        custom: "Label the elements that match a selector.",
      },
    },
    { name: "selector", type: "string", when: { filter: ["custom"] }, description: "Label the elements that match this CSS selector." },
    { name: "text", type: "string", default: "", description: "Keep only the links whose text holds this." },
    { name: "rapid", type: "bool", default: false, short: "r", description: "Keep hint mode open for more picks." },
  ],
  runs_in: "content",
  run: hint_run.run,
});
