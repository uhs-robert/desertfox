import { mode_escape, mode_pass_next, mode_set, SETTABLE_MODES } from "../content/handlers/mode.ts";
import { page_blur, page_focus_input } from "../content/handlers/page.ts";
import { define } from "../shared/registry/index.ts";

define("mode.set", {
  name: "mode",
  label: "Set Mode",
  intent: "Switch to a mode. Ignore mode passes every key to the page until a binding leaves it.",
  params: [{ name: "mode", type: "enum", values: SETTABLE_MODES }],
  runs_in: "content",
  modes: ["normal", "insert", "ignore"],
  run: mode_set.run,
});

define("mode.escape", {
  name: "escape",
  label: "Escape",
  intent: "Leave insert mode, drop the focus from the field and return to normal mode.",
  runs_in: "content",
  modes: ["normal", "insert"],
  run: mode_escape.run,
});

define("mode.pass_next", {
  name: "passnext",
  label: "Pass Next Key",
  intent: "Give the next key to the page instead of OasisFox.",
  runs_in: "content",
  run: mode_pass_next.run,
});

// Defined here with the mode commands because both change what has the focus.
define("page.focus_input", {
  name: "focusinput",
  label: "Focus Input",
  intent: "Focus the first visible text field on the page, preferring one in view.",
  runs_in: "content",
  run: page_focus_input.run,
});

define("page.blur", {
  name: "blur",
  label: "Blur",
  intent: "Drop the focus from the focused element.",
  runs_in: "content",
  run: page_blur.run,
});
