import { mode_escape, mode_pass_next, mode_set, SETTABLE_MODES } from "../content/handlers/mode.ts";
import { page_blur, page_focus_input } from "../content/handlers/page.ts";
import { define } from "../shared/registry/builtin.ts";

const mode_in_words = (mode: string) => (mode === "visual_line" ? "line visual" : mode);

define("mode.set", {
  name: "mode",
  label: "Set mode",
  intent: "Switch to a mode. Ignore mode passes every key to the page until a binding leaves it.",
  params: [
    {
      name: "mode",
      type: "enum",
      values: SETTABLE_MODES,
      value_labels: Object.fromEntries(SETTABLE_MODES.map((mode) => [mode, `to ${mode_in_words(mode)}`])),
    },
  ],
  runs_in: "content",
  modes: ["normal", "insert", "ignore", "caret", "visual", "visual_line"],
  run: mode_set.run,
});

define("mode.escape", {
  completion: "hidden",
  label: "Escape",
  intent: "Return to normal mode. It works from insert, hint, command line, caret and both visual modes, and drops the focus from the field.",
  runs_in: "content",
  modes: ["normal", "insert", "hint", "cmdline", "caret", "visual", "visual_line"],
  run: mode_escape.run,
});

define("mode.pass_next", {
  completion: "hidden",
  label: "Pass next key",
  intent: "Give the next key to the page instead of DesertFox.",
  runs_in: "content",
  run: mode_pass_next.run,
});

// Defined here with the mode commands because both change what has the focus.
define("page.focus_input", {
  completion: "hidden",
  label: "Focus input",
  intent: "Focus the first text field on the page. It takes the first visible field and prefers one in view.",
  runs_in: "content",
  run: page_focus_input.run,
});

define("page.blur", {
  completion: "hidden",
  label: "Blur",
  intent: "Drop the focus from the focused element.",
  runs_in: "content",
  run: page_blur.run,
});
