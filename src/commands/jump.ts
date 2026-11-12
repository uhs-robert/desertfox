import { define } from "../shared/registry/builtin.ts";

// Runs in the `page` bundle, which asks the background for the list of this window. Only the page can read its scroll position.
define("page.jump", {
  label: "Jump through positions",
  intent: "Go back or forward through the places big jumps left. The list is per window and a place may be in another tab: the jump switches to the tab that has the address, or opens the address in this tab. A count prefix moves that many places. It stops with a notice past either end of the list.",
  params: [
    { name: "direction", type: "enum", values: ["older", "newer"], value_labels: { older: "to an older place", newer: "to a newer place" }, description: { older: "Go back to the place the last jump left.", newer: "Go forward again, after going back." } },
    { name: "steps", type: "int", default: 1, min: 1, description: "Move this many places." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "steps" },
  bundle: "page",
  repeatable: false,
});
