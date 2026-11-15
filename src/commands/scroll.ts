import { SCROLL_TO_DEFAULT_AXIS } from "../content/handlers/scroll.ts";
import { define } from "../shared/registry/builtin.ts";

define("scroll.lines", {
  name: "scroll",
  label: "Scroll lines",
  intent: "Scroll the page by lines. A positive number scrolls down and a negative one scrolls up. A count prefix repeats the scroll.",
  params: [{ name: "count", type: "int", default: 1 }],
  bridge: true,
  runs_in: "content",
  count: "repeat",
});

define("scroll.pixels", {
  label: "Scroll pixels",
  intent: "Scroll the page by pixels. Use dx for right and dy for down.",
  params: [
    { name: "dx", type: "int", default: 0, description: "Scroll right by this many pixels." },
    { name: "dy", type: "int", default: 0, description: "Scroll down by this many pixels." },
  ],
  bridge: true,
  runs_in: "content",
  count: "repeat",
});

define("scroll.pages", {
  label: "Scroll pages",
  intent: "Scroll the page by a fraction of the view. The fraction is of the visible height. A negative fraction scrolls up.",
  params: [
    { name: "fraction", type: "float", default: 1, description: "Scroll this share of the view height." },
    { name: "count", type: "int", default: 1, description: "Scroll this many fractions in one move." },
  ],
  bridge: true,
  runs_in: "content",
  count: { param: "count" },
});

define("scroll.to", {
  label: "Scroll to",
  intent: "Jump to a position on the page. The position is a percent, where 0 is the top or left edge and 100 is the bottom or right edge.",
  params: [
    { name: "percent", type: "float" },
    { name: "axis", type: "enum", values: ["x", "y"], default: SCROLL_TO_DEFAULT_AXIS, short: { x: "x" }, value_labels: { x: "horizontally" }, description: { x: "Jump along the horizontal axis." } },
  ],
  bridge: true,
  runs_in: "content",
  // The line edges `$` and `^` are no jumps.
  jumps: (args) => args.axis !== "x",
});

define("scroll.align", {
  label: "Align focus",
  intent: "Align the focused element in the view. It scrolls the focus to the top, center or bottom. The focus is the focused element, or else the selection.",
  params: [{ name: "position", type: "enum", values: ["top", "center", "bottom"], default: "center", short: { top: "t", bottom: "b" }, value_labels: { top: "to top", bottom: "to bottom" }, description: { top: "Align the focus to the top.", bottom: "Align the focus to the bottom." } }],
  bridge: true,
  runs_in: "content",
  bundle: "page",
});
