import type { Mode } from "../../shared/index.ts";
import { bundles } from "../bundles.ts";
import { page_mode } from "../page_mode.ts";
import type { ContentHandler } from "./types.ts";
import { blur_focused_element } from "./page.ts";

export const SETTABLE_MODES = ["normal", "insert", "ignore", "caret", "visual"] as const;

export const mode_set: ContentHandler = {
  run: (args) => page_mode.set_mode(args.mode as Mode),
};

export const mode_escape: ContentHandler = {
  run: () => {
    // After a search, Escape takes the highlights off. Without the bundle there are none.
    if (bundles.has_handler("find.clear")) bundles.run_command("find.clear", "caret", {}, "", false);
    if (bundles.has_handler("hint.unhover")) bundles.run_command("hint.unhover", "hints", {}, "", false);
    page_mode.escape();
    blur_focused_element();
  },
};

// The key listener swallows the next key and lets the page have it.
export const mode_pass_next: ContentHandler = {
  run: () => page_mode.arm_pass_next(),
};
