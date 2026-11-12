import { define } from "../shared/registry/builtin.ts";

define("heading.go", {
  name: "heading",
  label: "Go to heading",
  intent: "Scroll a heading of the page to the top of the view. The list shows every heading in page order, indented by level, and typing narrows it to the best matches. A pick or a number scrolls to that heading, and text alone scrolls to the best match. The scroll leaves focus, the caret and the address alone.",
  params: [{ name: "heading", type: "string", rest: true, main: true, values: { from: "headings" } }],
  bridge: false,
  runs_in: "content",
  bundle: "hints",
  jumps: true,
});
