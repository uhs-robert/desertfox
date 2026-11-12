import { deepest_focused_element } from "../editable.ts";
import { bundles } from "../bundles.ts";
import { remember_blurred } from "./last_blurred.ts";
import type { ContentHandler } from "./types.ts";

export function blur_focused_element(): void {
  const focused = deepest_focused_element();
  if (focused instanceof HTMLElement && focused !== document.body) {
    remember_blurred(focused);
    focused.blur();
  }
  hand_focus_to_parent();
}

// A same-origin child frame may be a hidden input frame, which the `ui` bundle hands off. Other frames never load it. The first call waits on the load, and the hand-off then reads the mode as it is by then.
export const hand_focus_to_parent = (keep_field = true): void => void (window.frameElement && bundles.run_command_("ui.hand_focus", "ui", { keep_field }, "", false));

export const page_blur: ContentHandler = {
  run: blur_focused_element,
};
