import type { Mode } from "../../shared/index.ts";
import { bundles } from "../bundles.ts";
import { page_mode } from "../page_mode.ts";
import type { ContentHandler } from "./types.ts";
import { blur_focused_element } from "./page.ts";

export const SETTABLE_MODES = ["normal", "insert", "ignore", "caret", "visual", "visual_line"] as const;

export const mode_set: ContentHandler = {
  run: (args) => page_mode.set_mode_(args.mode as Mode),
};

export const mode_escape: ContentHandler = {
  run: () => {
    // After a search, Escape takes the highlights off. Without the bundle there are none.
    if (bundles.has_handler_("find.clear")) bundles.run_command_("find.clear", "caret", {}, "", false);
    if (bundles.has_handler_("hint.unhover")) bundles.run_command_("hint.unhover", "hints", {}, "", false);
    page_mode.escape();
    blur_focused_element();
  },
};

// The key listener swallows the next key and lets the page have it.
export const mode_pass_next: ContentHandler = {
  run: () => page_mode.arm_pass_next_(),
};
