import { caret_move } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";

define("caret.move", {
  completion: ["caret", "visual"],
  label: "Move caret",
  intent: "Move the caret or extend the selection. In caret mode it moves the caret and in visual mode it extends the selection.",
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
      description: {
        char: "Move by character.",
        word: "Move by word.",
        word_end: "Move to the end of the word.",
        line: "Move by line.",
        line_start: "Move to the start of the line.",
        line_first: "Move to the first non-blank of the line.",
        line_end: "Move to the end of the line.",
        start: "Move to the start of the text.",
        end: "Move to the end of the text.",
      },
    },
    { name: "direction", type: "enum", values: ["forward", "back"], default: "forward", value_labels: { back: "backward" }, description: { back: "Move backward." } },
    { name: "big", type: "bool", default: false, description: "Read a word as any run of non-blank characters." },
  ],
  runs_in: "content",
  count: "repeat",
  modes: ["caret", "visual"],
  run: caret_move.run,
});
