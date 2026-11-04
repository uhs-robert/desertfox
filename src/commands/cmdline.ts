import { cmdline_clear, cmdline_help, cmdline_history, cmdline_next_completion, cmdline_open, cmdline_prev_completion, cmdline_submit } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";

define("cmdline.open", {
  completion: "hidden",
  label: "Command line",
  intent: "Open the command line, with text already typed if given.",
  params: [{ name: "text", type: "string", default: "", description: "Put this text in the line." }],
  runs_in: "content",
  run: cmdline_open.run,
});

define("cmdline.next_completion", {
  completion: "hidden",
  label: "Next completion",
  intent: "Select the next completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_next_completion.run,
});

define("cmdline.prev_completion", {
  completion: "hidden",
  label: "Previous completion",
  intent: "Select the previous completion in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_prev_completion.run,
});

define("cmdline.submit", {
  completion: "hidden",
  label: "Submit",
  intent: "Run the text typed in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_submit.run,
});

define("cmdline.history", {
  completion: "hidden",
  label: "History",
  intent: "Recall a command from history. It puts an earlier or later command into the command line.",
  params: [{ name: "direction", type: "enum", values: ["prev", "next"], value_labels: { prev: "to older entry", next: "to newer entry" } }],
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_history.run,
});

define("cmdline.clear", {
  completion: "hidden",
  label: "Clear line",
  intent: "Delete the text typed in the command line.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_clear.run,
});

define("cmdline.help", {
  completion: "hidden",
  label: "Command help",
  intent: "Open help for the selected or typed command.",
  runs_in: "content",
  modes: ["cmdline"],
  run: cmdline_help.run,
});
