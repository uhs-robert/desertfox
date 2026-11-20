import { SETTABLE_MODES } from "../content/handlers/mode.ts";
import { define } from "../shared/registry/builtin.ts";
import { require_tab_id } from "./open_target.ts";

const mode_in_words = (mode: string) => (mode === "visual_line" ? "line visual" : mode === "item_visual" ? "visual item" : mode);

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
  bridge: true,
  runs_in: "content",
  repeatable: false,
  modes: ["normal", "insert", "ignore", "caret", "visual", "visual_line", "item", "item_visual"],
});

// The mode itself is a column of a site table row, so this command takes the mode's name and no list of values. A name the page's rows lack does nothing.
define("mode.site", {
  label: "Site mode",
  intent: "Start a named mode of the site table, or end it with off. The mode adds its own keys to normal mode and shows its label in the badge. Escape, any key DesertFox leaves to the page, a mouse press and any mode change end it, except in a sticky mode, which ignores the mouse press and the key. With toggle, a second start ends the mode, and a start leaves a text field and the mode it came from first.",
  params: [
    { name: "name", type: "string", main: true, description: "Start this mode, or off to end the one that runs." },
    { name: "toggle", type: "bool", default: false, description: "End the mode when it already runs." },
  ],
  bridge: false,
  runs_in: "content",
  repeatable: false,
});

// `main.ts` wires the background half after it builds the tab state.
let enter_tab_insert: ((tab_id: number) => Promise<void>) | undefined;
export const wire_tab_insert = (enter: (tab_id: number) => Promise<void>) => void (enter_tab_insert = enter);

define("mode.insert", {
  label: "Insert mode",
  intent: "Give every key to the page in all frames. No field is needed. Escape leaves it. A frame under an all-off site rule stays in ignore mode.",
  bridge: true,
  runs_in: "background",
  repeatable: false,
  modes: ["normal", "caret", "visual", "visual_line", "item"],
  run: (ctx) => enter_tab_insert?.(require_tab_id(ctx)),
});

define("mode.escape", {
  completion: "hidden",
  label: "Escape",
  intent: "Return to normal mode. It works from insert, hint, command line, caret, both visual modes, media mode and item mode, and from visual item mode back to item mode, where it also leaves fullscreen, and drops the focus from the field.",
  bridge: true,
  runs_in: "content",
  repeatable: false,
  modes: ["normal", "insert", "hint", "cmdline", "caret", "visual", "visual_line", "media", "item", "item_visual"],
});

define("mode.pass_next", {
  completion: "hidden",
  label: "Pass next key",
  intent: "Give the next key to the page instead of DesertFox.",
  bridge: false,
  runs_in: "content",
  repeatable: false,
  modes: ["normal", "item"],
});

// Defined here with the mode commands because both change what has the focus.
define("page.focus_input", {
  completion: "hidden",
  label: "Focus input",
  intent: "Focus the first text field on the page. It takes the first visible field and prefers one in view.",
  bridge: false,
  runs_in: "content",
  bundle: "page",
  modes: ["normal", "item"],
});

define("page.blur", {
  completion: "hidden",
  label: "Blur",
  intent: "Drop the focus from the focused element.",
  bridge: false,
  runs_in: "content",
});
