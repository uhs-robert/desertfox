// Registered in phase 1 so keys, help and the command line know them. Running one refuses.

import { NEEDS_COMMAND_LINE, needs_command_line, needs_hints } from "../content/handlers/phase_2.ts";
import { define } from "../shared/registry/index.ts";
import { WHERE_PARAM } from "./open_target.ts";

const refuse_needing_command_line = () => {
  throw new Error(NEEDS_COMMAND_LINE);
};

define("hint.run", {
  name: "hint",
  label: "Hint",
  intent: "Label the elements on the page with keys, then act on the one you pick.",
  params: [
    {
      name: "action",
      type: "enum",
      values: ["open", "background", "window", "select", "copy_link", "copy_text", "delete", "focus"],
      default: "open",
    },
    { name: "filter", type: "enum", values: ["all", "clickable", "inputs", "links", "custom"], default: "clickable" },
    { name: "selector", type: "string", when: { filter: ["custom"] } },
    { name: "rapid", type: "bool", default: false },
  ],
  runs_in: "content",
  run: needs_hints.run,
});

define("cmdline.open", {
  name: "cmdline",
  label: "Command Line",
  intent: "Open the command line.",
  runs_in: "content",
  run: needs_command_line.run,
});

define("cmdline.next_completion", {
  name: "nextcomp",
  label: "Next Completion",
  intent: "Select the next completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: needs_command_line.run,
});

define("cmdline.prev_completion", {
  name: "prevcomp",
  label: "Previous Completion",
  intent: "Select the previous completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: needs_command_line.run,
});

define("help.whichkey", {
  name: "whichkey",
  label: "Which Key",
  intent: "List the keys that can follow the keys typed so far.",
  runs_in: "content",
  run: needs_command_line.run,
});

define("tab.switch", {
  name: "tab",
  label: "Switch Tab",
  intent: "Switch to an open tab chosen by title or address.",
  params: [{ name: "tab", type: "string", rest: true, main: true }],
  runs_in: "background",
  run: refuse_needing_command_line,
});

define("bookmark.open", {
  name: "bookmark",
  label: "Open Bookmark",
  intent: "Open a bookmark chosen by title or address.",
  params: [{ name: "bookmark", type: "string", rest: true, main: true }, WHERE_PARAM],
  runs_in: "background",
  run: refuse_needing_command_line,
});
