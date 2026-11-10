// The mode of this frame and the one-shot "pass the next key" flag. Pure, so the transitions are testable.

import type { Mode } from "../shared/index.ts";
import { is_caret_mode } from "../shared/command.ts";

export function create_mode_state(initial: Mode = "normal") {
  let mode = initial;
  let pass_next_armed = false;
  // Insert entered by `i` has no field, so focus leaving a field must not end it. Only a mode set ends it.
  let manual_insert = false;
  let on_change: (mode: Mode) => void = () => {};
  let on_display_change: () => void = () => {};

  const follow_focus_to_ = (next: Mode) => {
    if (next === mode) return;
    mode = next;
    on_change(mode);
    on_display_change();
  };

  const set_mode_ = (next: Mode) => {
    manual_insert = next === "insert";
    follow_focus_to_(next);
  };

  return {
    is_manual_insert_: () => manual_insert,
    get_mode_: () => mode,
    set_mode_,
    listen: (listener: (mode: Mode) => void) => {
      on_change = listener;
    },
    // Fires after any change a mode indicator shows: the mode or the pass-next flag.
    listen_display_: (listener: () => void) => {
      on_display_change = listener;
    },
    is_pass_next_armed_: () => pass_next_armed,
    // Normal, caret and both visual modes follow focus, so a field never loses typing to motion keys. Ignore, hint and command line modes keep the keys.
    focus_entered_editable_: () => {
      if (mode === "normal" || is_caret_mode(mode)) follow_focus_to_("insert");
    },
    focus_left_editable_: () => {
      if (mode === "insert" && !manual_insert) follow_focus_to_("normal");
    },
    // Ignore mode is left only by its own binding, never by Escape.
    escape: () => {
      if (mode !== "ignore") set_mode_("normal");
    },
    arm_pass_next_: () => {
      pass_next_armed = true;
      on_display_change();
    },
    take_pass_next_: () => {
      const was_armed = pass_next_armed;
      pass_next_armed = false;
      if (was_armed) on_display_change();
      return was_armed;
    },
  };
}

export type ModeState = ReturnType<typeof create_mode_state>;
