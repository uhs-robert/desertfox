import { define } from "../shared/registry/builtin.ts";

define("cmdline.open", {
  completion: "hidden",
  label: "Command line",
  intent: "Open the command line, with text already typed if given.",
  params: [{ name: "text", type: "string", optional: true, description: "Put this text in the line." }],
  runs_in: "content",
  bundle: "cmdline",
});

define("cmdline.next_completion", {
  completion: "hidden",
  label: "Next completion",
  intent: "Select the next completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});

define("cmdline.prev_completion", {
  completion: "hidden",
  label: "Previous completion",
  intent: "Select the previous completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});

define("cmdline.submit", {
  completion: "hidden",
  label: "Submit",
  intent: "Run the text typed in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});

define("cmdline.history", {
  completion: "hidden",
  label: "History",
  intent: "Recall a command from history. It puts an earlier or later command into the command line.",
  params: [{ name: "direction", type: "enum", values: ["prev", "next"], value_labels: { prev: "to older entry", next: "to newer entry" } }],
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});

define("cmdline.clear", {
  completion: "hidden",
  label: "Clear line",
  intent: "Delete the text typed in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});

define("cmdline.help", {
  completion: "hidden",
  label: "Command help",
  intent: "Open help for the selected or typed command.",
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});

define("list.act", {
  completion: "hidden",
  label: "Act on rows",
  intent: "Act on the selected tabs. Without a selection, act on the highlighted row.",
  params: [
    {
      name: "action",
      type: "enum",
      values: ["unload", "close", "mute", "pin", "reopen"],
      description: {
        unload: "Unload the loaded tabs, or load all when none is loaded.",
        close: "Close the tabs and move the highlight to the next row.",
        mute: "Mute all when any is not muted, else unmute all.",
        pin: "Pin all when any is not pinned, else unpin all.",
        reopen: "Ask for a container, then reopen the tabs in it.",
      },
    },
  ],
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});

define("list.select", {
  completion: "hidden",
  label: "Select tabs",
  intent: "Mark or unmark the highlighted tab. Or clear every mark.",
  params: [{ name: "action", type: "enum", values: ["toggle", "clear"], description: { toggle: "Mark or unmark the highlighted tab, then move down.", clear: "Unmark every tab." } }],
  runs_in: "content",
  modes: ["cmdline"],
  bundle: "cmdline",
});
