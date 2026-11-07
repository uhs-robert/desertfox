import { find_next, find_open, find_prev } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";

define("find.open", {
  name: "find",
  completion: "hidden",
  modes: ["normal", "caret", "visual", "visual_line"],
  label: "Find",
  intent: "Search the page text as you type. Enter keeps the match. Escape clears the highlights and keeps the search and the current match as your position. The text is a regular expression, and a capital letter makes it match case. In caret mode the caret goes to the match. In visual mode the caret end goes to the match and the anchor stays. With `--word` there is no line: it searches the word under the caret, or the selected text in visual mode.",
  params: [{ name: "direction", type: "enum", values: ["forward", "backward"], default: "forward", value_labels: { backward: "backward" }, description: { backward: "Search up the page, and let n go up." } },
    { name: "source", type: "enum", values: ["typed", "word"], default: "typed", value_labels: { word: "word" }, description: { word: "Search the word or selection at the caret." } },
  ],
  runs_in: "content",
  run: find_open.run,
});

define("find.next", {
  completion: "hidden",
  modes: ["normal", "caret", "visual", "visual_line"],
  label: "Next match",
  intent: "Go to the next match of the last search. It goes the way the search was started. In caret mode the caret goes to the match. In visual mode the caret end goes to the match and the anchor stays.",
  runs_in: "content",
  run: find_next.run,
});

define("find.prev", {
  completion: "hidden",
  modes: ["normal", "caret", "visual", "visual_line"],
  label: "Previous match",
  intent: "Go to the previous match of the last search. It goes against the way the search was started. In caret mode the caret goes to the match. In visual mode the caret end goes to the match and the anchor stays.",
  runs_in: "content",
  run: find_prev.run,
});
