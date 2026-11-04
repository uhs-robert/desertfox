import { find_next, find_open, find_prev } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";

// No command line name yet: the one-word grammar list in docs/design.md has to take `find` first.
define("find.open", {
  completion: "hidden",
  label: "Find",
  intent: "Search the page text as you type. Enter keeps the match and Escape goes back to where you were. The text is a regular expression, and a capital letter makes it match case.",
  params: [{ name: "direction", type: "enum", values: ["forward", "backward"], default: "forward", value_labels: { backward: "backward" }, description: { backward: "Search up the page, and let n go up." } }],
  runs_in: "content",
  run: find_open.run,
});

define("find.next", {
  completion: "hidden",
  label: "Next match",
  intent: "Go to the next match of the last search. It goes the way the search was started.",
  runs_in: "content",
  run: find_next.run,
});

define("find.prev", {
  completion: "hidden",
  label: "Previous match",
  intent: "Go to the previous match of the last search. It goes against the way the search was started.",
  runs_in: "content",
  run: find_prev.run,
});
