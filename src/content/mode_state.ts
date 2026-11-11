// The mode of this frame and the one-shot "pass the next key" flag. Pure, so the transitions are testable.

import type { Mode } from "../shared/index.ts";
import { is_caret_mode } from "../shared/command.ts";
// The mode a fullscreen change brings, or a start or end of the media mode in another frame, else undefined when the mode stays. Only normal mode starts the media mode, so insert, ignore, hint and the reading modes win, and only the media mode ends with it.
// The mode a fullscreen change brings, or the media mode starting or ending in another frame, or undefined when the mode stays. Only normal mode starts the media mode, so insert, ignore, hint and the reading modes win, and only the media mode ends with the fullscreen.
export const fullscreen_step = (mode: Mode, has_fullscreen_element: boolean): Mode | undefined => (has_fullscreen_element ? (mode === "normal" ? "media" : undefined) : mode === "media" ? "normal" : undefined);

export function create_mode_state(initial: Mode = "normal") {
  let mode = initial;
  let pass_next_armed = false;
  // Insert entered by `i` has no field, so focus leaving a field must not end it. Only a mode set ends it.
  let manual_insert = false;
  // Where hint and command line mode return to: media mode when they were opened from it, else normal.
  let back_mode: Mode = "normal";
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
    if ((next === "hint" || next === "cmdline") && mode !== "hint" && mode !== "cmdline") back_mode = mode === "media" ? "media" : "normal";
    follow_focus_to_(next);
  };

  return {
    // The media mode ended (the fullscreen, or in another frame) while hint or command line mode was open, so closing it lands in normal mode.
    back_to_normal_: () => void (back_mode = "normal"),
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
    // Normal, media, caret and both visual modes follow focus, so a field never loses typing to motion keys. Ignore, hint and command line modes keep the keys.
    focus_entered_editable_: () => {
      if (mode === "normal" || mode === "media" || is_caret_mode(mode)) follow_focus_to_("insert");
    },
    focus_left_editable_: () => {
      if (mode === "insert" && !manual_insert) follow_focus_to_("normal");
    },
    // Ignore mode is left only by its own binding, never by Escape. Hint and command line mode return to where they began.
    escape: () => {
      if (mode !== "ignore") set_mode_(mode === "hint" || mode === "cmdline" ? back_mode : "normal");
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
