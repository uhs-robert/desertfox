import { SETTABLE_MODES } from "../content/handlers/mode.ts";
import { define } from "../shared/registry/builtin.ts";
import { require_tab_id } from "./open_target.ts";

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
  repeatable: false,
  modes: ["normal", "insert", "ignore", "caret", "visual", "visual_line"],
});

// `main.ts` wires the background half after it builds the tab state.
let enter_tab_insert: ((tab_id: number) => Promise<void>) | undefined;
export const wire_tab_insert = (enter: (tab_id: number) => Promise<void>) => void (enter_tab_insert = enter);

define("mode.insert", {
  label: "Insert mode",
  intent: "Give every key to the page in all frames. No field is needed. Escape leaves it. A frame under an all-off site rule stays in ignore mode.",
  runs_in: "background",
  repeatable: false,
  modes: ["normal", "caret", "visual", "visual_line"],
  run: (ctx) => enter_tab_insert?.(require_tab_id(ctx)),
});

define("mode.escape", {
  completion: "hidden",
  label: "Escape",
  intent: "Return to normal mode. It works from insert, hint, command line, caret and both visual modes, and drops the focus from the field.",
  runs_in: "content",
  repeatable: false,
  modes: ["normal", "insert", "hint", "cmdline", "caret", "visual", "visual_line"],
});

define("mode.pass_next", {
  completion: "hidden",
  label: "Pass next key",
  intent: "Give the next key to the page instead of DesertFox.",
  runs_in: "content",
  repeatable: false,
});

// Defined here with the mode commands because both change what has the focus.
define("page.focus_input", {
  completion: "hidden",
  label: "Focus input",
  intent: "Focus the first text field on the page. It takes the first visible field and prefers one in view.",
  runs_in: "content",
  bundle: "page",
});

define("page.blur", {
  completion: "hidden",
  label: "Blur",
  intent: "Drop the focus from the focused element.",
  runs_in: "content",
});
