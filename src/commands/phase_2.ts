// Registered in phase 1 so keys, help and the command line know them. Running one refuses.

import { caret_move, cmdline_clear, cmdline_history, cmdline_submit, visual_act, cmdline_next_completion, cmdline_open, cmdline_prev_completion, help_whichkey, hint_run, NEEDS_COMMAND_LINE } from "../content/handlers/phase_2.ts";
import { define } from "../shared/registry/index.ts";
import { WHERE, WHERE_PARAM } from "./open_target.ts";

const refuse_needing_command_line = () => {
  throw new Error(NEEDS_COMMAND_LINE);
};

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
      value_labels: { all: "for all elements", inputs: "for inputs", links: "for links", custom: "for a selector" },
    },
    { name: "selector", type: "string", when: { filter: ["custom"] } },
    { name: "text", type: "string", default: "" },
    { name: "rapid", type: "bool", default: false },
  ],
  runs_in: "content",
  run: hint_run.run,
});

define("cmdline.open", {
  name: "cmdline",
  label: "Command line",
  intent: "Open the command line, with text already typed if given.",
  params: [{ name: "text", type: "string", default: "" }],
  runs_in: "content",
  run: cmdline_open.run,
});

define("cmdline.next_completion", {
  name: "nextcomp",
  label: "Next completion",
  intent: "Select the next completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_next_completion.run,
});

define("cmdline.prev_completion", {
  name: "prevcomp",
  label: "Previous completion",
  intent: "Select the previous completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_prev_completion.run,
});

define("help.whichkey", {
  name: "whichkey",
  label: "Which key",
  intent: "List the keys at the top of the keymap.",
  runs_in: "content",
  modes: ["normal", "caret", "visual"],
  run: help_whichkey.run,
});

define("tab.switch", {
  name: "tab",
  label: "Switch tab",
  intent: "Switch to an open tab chosen by title or address.",
  params: [{ name: "tab", type: "string", rest: true, main: true }],
  runs_in: "background",
  run: refuse_needing_command_line,
});

define("bookmark.open", {
  name: "bookmark",
  label: "Open bookmark",
  intent: "Open a bookmark chosen by title or address.",
  params: [{ name: "bookmark", type: "string", rest: true, main: true }, WHERE_PARAM],
  runs_in: "background",
  run: refuse_needing_command_line,
});

define("cmdline.submit", {
  name: "submit",
  label: "Submit",
  intent: "Run the text typed in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_submit.run,
});

define("cmdline.history", {
  name: "history",
  label: "History",
  intent: "Put an earlier or later command from the command line history into the line.",
  params: [{ name: "direction", type: "enum", values: ["prev", "next"], value_labels: { prev: "to older entry", next: "to newer entry" } }],
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_history.run,
});

define("cmdline.clear", {
  name: "clearline",
  label: "Clear line",
  intent: "Delete the text typed in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_clear.run,
});

define("caret.move", {
  name: "move",
  label: "Move caret",
  intent: "Move the caret in caret mode, or extend the selection in visual mode.",
  params: [
    {
      name: "unit",
      type: "enum",
      values: ["char", "word", "word_end", "line", "line_start", "line_first", "line_end", "start", "end"],
      value_labels: {
        char: "by character",
        word: "by word",
        word_end: "to word end",
        line: "by line",
        line_start: "to line start",
        line_first: "to first non-blank",
        line_end: "to line end",
        start: "to text start",
        end: "to text end",
      },
    },
    { name: "direction", type: "enum", values: ["forward", "back"], default: "forward", value_labels: { back: "backward" } },
    { name: "big", type: "bool", default: false },
  ],
  runs_in: "content",
  count: "repeat",
  modes: ["caret", "visual"],
  run: caret_move.run,
});

define("visual.act", {
  name: "visualact",
  label: "Act on selection",
  intent: "Copy the selection, swap its ends or search for it.",
  params: [{ name: "action", type: "enum", values: ["yank", "swap", "search"], value_labels: { yank: "to copy", swap: "to swap ends", search: "to search" } }],
  runs_in: "content",
  modes: ["visual"],
  run: visual_act.run,
});
