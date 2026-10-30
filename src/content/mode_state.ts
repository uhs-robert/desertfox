// The mode of this frame and the one-shot "pass the next key" flag. Pure, so the transitions are testable.

import type { Mode } from "../shared/index.ts";

export function create_mode_state(initial: Mode = "normal") {
  let mode = initial;
  let pass_next_armed = false;
  let on_change: (mode: Mode) => void = () => {};

  const set_mode = (next: Mode) => {
    if (next === mode) return;
    mode = next;
    on_change(mode);
  };

  return {
    get_mode: () => mode,
    set_mode,
    listen: (listener: (mode: Mode) => void) => {
      on_change = listener;
    },
    // Only normal mode follows focus. Ignore, hint and command line modes keep the keys.
    focus_entered_editable: () => {
      if (mode === "normal") set_mode("insert");
    },
    focus_left_editable: () => {
      if (mode === "insert") set_mode("normal");
    },
    // Ignore mode is left only by its own binding, never by Escape.
    escape: () => {
      if (mode !== "ignore") set_mode("normal");
    },
    arm_pass_next: () => {
      pass_next_armed = true;
    },
    take_pass_next: () => {
      const was_armed = pass_next_armed;
      pass_next_armed = false;
      return was_armed;
    },
  };
}

export type ModeState = ReturnType<typeof create_mode_state>;
