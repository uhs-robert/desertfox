import { caret_move } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";

define("caret.move", {
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
