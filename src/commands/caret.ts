import { define } from "../shared/registry/builtin.ts";

define("caret.move", {
  completion: ["caret", "visual", "visual_line"],
  label: "Move caret",
  intent: "Move the caret or extend the selection. In caret mode it moves the caret and in visual mode it extends the selection.",
  params: [
    {
      name: "unit",
      type: "enum",
      values: ["char", "word", "word_end", "line", "line_start", "line_first", "line_end", "start", "end", "find_repeat"],
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
        find_repeat: "repeat the last character find",
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
        find_repeat: "Repeat the last character find.",
      },
    },
    { name: "direction", type: "enum", values: ["forward", "back"], default: "forward", value_labels: { back: "backward" }, description: { back: "Move backward." } },
    { name: "big", type: "bool", default: false, description: "Read a word as any run of non-blank characters." },
  ],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  count: "repeat",
  modes: ["caret", "visual", "visual_line"],
  bundle: "caret",
});

// The target is a `key` param, so the key layer reads the character and a macro records it with the step.
define("caret.find", {
  completion: ["caret", "visual", "visual_line"],
  label: "Move to a character",
  intent: "Move the caret to a typed character and light its matches.",
  params: [
    { name: "char", type: "key", description: "Move to this character." },
    { name: "direction", type: "enum", values: ["forward", "back"], default: "forward", value_labels: { back: "backward" }, description: { back: "Search backward." } },
    { name: "till", type: "bool", default: false, description: "Stop before the match, or after it going backward." },
    { name: "count", type: "int", default: 1, min: 1, description: "Move to this match." },
  ],
  bridge: false,
  runs_in: "content",
  repeatable: false,
  // A param and not "repeat": a repeated run of a till find would stall on its first match.
  count: { param: "count" },
  modes: ["caret", "visual", "visual_line"],
  bundle: "caret",
});
