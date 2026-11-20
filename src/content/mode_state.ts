// The mode of this frame and the one-shot "pass the next key" flag. Pure, so the transitions are testable.

import type { Mode } from "../shared/index.ts";
import type { MediaStep } from "../shared/messages.ts";
import { is_caret_mode } from "../shared/command.ts";

// The mode a fullscreen change brings, or the media mode starting or ending in another frame, or undefined when the mode stays. Normal mode starts the media mode and the item mode. The two also take each other, so `aa` in item mode and the Escape back from media mode reach every frame in either order. Insert, ignore, hint and the reading modes win, and only the held mode ends with the step.
// `held` is the mode the step is for: item mode takes the same step, started and ended by the background (`tab_item.ts`).
export const fullscreen_step = (mode: Mode, has_fullscreen_element: boolean, held: Mode = "media"): Mode | undefined =>
  has_fullscreen_element ? (mode === "normal" || mode === (held === "media" ? "item" : "media") ? held : undefined) : mode === held ? "normal" : undefined;

// A frame skips the step that its own report of the mode caused. That step can arrive after the frame left the mode (a site key that ends its fullscreen at once), and would put it back.
export const takes_media_step = (step: MediaStep, frame_id: number): boolean => step.from !== frame_id;

// Hint and command line mode, the two that return to where they began.
const is_line = (mode: Mode): boolean => mode === "hint" || mode === "cmdline";

export function create_mode_state(initial: Mode = "normal") {
  let mode = initial;
  let pass_next_armed = false;
  // Insert entered by `i` has no field, so focus leaving a field must not end it. Only a mode set ends it.
  let manual_insert = false;
  // Where hint and command line mode return to: media mode when they were opened from it, else normal.
  let back_mode: Mode = "normal";
  // The media mode began in item mode, so Escape goes back to item mode.
  let media_from_item = false;
  // True while Escape changes the mode, so the report it causes is the frame's own and not a step's.
  let escaping = false;
  let on_change: (mode: Mode) => void = () => {};
  let on_display_change: () => void = () => {};

  const follow_focus_to_ = (next: Mode) => {
    if (next === mode) return;
    // Focus ends media mode without set_mode_, so the origin is dropped here for every route out.
    if (next !== "media" && !is_line(next)) media_from_item = false;
    mode = next;
    on_change(mode);
    on_display_change();
  };

  const set_mode_ = (next: Mode) => {
    manual_insert = next === "insert";
    if (next === "media") media_from_item ||= mode === "item" || (is_line(mode) && back_mode === "item");
    if (is_line(next) && !is_line(mode)) back_mode = mode === "media" || mode === "item" ? mode : "normal";
    follow_focus_to_(next);
  };

  return {
    // The media mode ended, and this is the mode to take (undefined: stay). `own` is a fullscreen that ended in this frame. A line or hint opened from media mode then closes to it, because Firefox spends the Escape on leaving fullscreen and the user did not ask to leave the mode. Otherwise hint and the line close to normal mode.
    media_ended_: (own?: boolean, held?: Mode): Mode | undefined => {
      if (own && is_line(mode) && back_mode === "media") return "media";
      back_mode = "normal";
      return fullscreen_step(mode, false, held);
    },
    is_escaping_: () => escaping,
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
    // Normal, media, item, caret and both visual modes follow focus, so a field never loses typing to motion keys. Ignore, hint and command line modes keep the keys.
    focus_entered_editable_: () => {
      if (mode === "normal" || mode === "media" || mode === "item" || is_caret_mode(mode)) follow_focus_to_("insert");
    },
    focus_left_editable_: () => {
      if (mode === "insert" && !manual_insert) follow_focus_to_("normal");
    },
    // Ignore mode is left only by its own binding, never by Escape. Hint and command line mode return to where they began.
    escape: () => {
      if (mode === "ignore") return;
      escaping = true;
      try {
        set_mode_(is_line(mode) ? back_mode : mode === "media" && media_from_item ? "item" : "normal");
      } finally {
        escaping = false;
      }
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
