import { scroll_lines, scroll_pages, scroll_pixels, scroll_to, SCROLL_TO_DEFAULT_AXIS } from "../content/handlers/scroll.ts";
import { define } from "../shared/registry/index.ts";

define("scroll.lines", {
  name: "scroll",
  label: "Scroll Lines",
  intent: "Scroll the page down by lines. A negative number scrolls up. A count prefix repeats the scroll.",
  params: [{ name: "count", type: "int", default: 1 }],
  runs_in: "content",
  count: "repeat",
  run: scroll_lines.run,
});

define("scroll.pixels", {
  name: "scrollpx",
  label: "Scroll Pixels",
  intent: "Scroll the page by a number of pixels, right for dx and down for dy.",
  params: [
    { name: "dx", type: "int", default: 0 },
    { name: "dy", type: "int", default: 0 },
  ],
  runs_in: "content",
  count: "repeat",
  run: scroll_pixels.run,
});

define("scroll.pages", {
  name: "scrollpage",
  label: "Scroll Pages",
  intent: "Scroll down by a fraction of the visible height. A negative fraction scrolls up.",
  params: [{ name: "fraction", type: "float", default: 1 }],
  runs_in: "content",
  count: "repeat",
  run: scroll_pages.run,
});

define("scroll.to", {
  name: "scrollto",
  label: "Scroll To",
  intent: "Jump to a percent of the page, from the top or left edge at 0 to the bottom or right edge at 100.",
  params: [
    { name: "percent", type: "float" },
    { name: "axis", type: "enum", values: ["x", "y"], default: SCROLL_TO_DEFAULT_AXIS },
  ],
  runs_in: "content",
  run: scroll_to.run,
});
