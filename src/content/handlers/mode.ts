import type { Mode } from "../../shared/index.ts";
import type { LeaveTabInsert } from "../../shared/messages.ts";
import { bundles } from "../bundles.ts";
import { page_mode } from "../page_mode.ts";
import { site_mode } from "../site_mode.ts";
import type { ContentHandler } from "./types.ts";
import { blur_focused_element, hand_focus_to_parent } from "./page.ts";

export const SETTABLE_MODES = ["normal", "insert", "ignore", "caret", "visual", "visual_line"] as const;

// A caret mode answers once caret.js has set it.
export const mode_set: ContentHandler = {
  run: (args) => {
    const set = bundles.set_mode_(args.mode as Mode);
    // Normal mode set over a focused field never blurs it, so a hidden input frame hands off here. A caret mode that waits on caret.js still reads as normal, and must keep the focus.
    if (args.mode === "normal") hand_focus_to_parent(false);
    return set;
  },
};

// The site mode is an overlay, not a mode, so this handler and the key listener are all that start and end it.
export const mode_site: ContentHandler = {
  run: (args) => site_mode.set_(args.name === "off" ? undefined : (args.name as string)),
};

export const mode_escape: ContentHandler = {
  run: () => {
    site_mode.set_();
    // After a search, Escape takes the highlights off. Without the bundle there are none.
    if (bundles.has_handler_("find.clear")) bundles.run_command_("find.clear", "caret", {}, "", false);
    if (bundles.has_handler_("hint.unhover")) bundles.run_command_("hint.unhover", "hints", {}, "", false);
    if (page_mode.is_manual_insert_()) void browser.runtime.sendMessage({ type: "leave_tab_insert" } satisfies LeaveTabInsert).catch(() => undefined);
    page_mode.escape();
    blur_focused_element();
  },
};

// The key listener swallows the next key and lets the page have it.
export const mode_pass_next: ContentHandler = {
  run: () => page_mode.arm_pass_next_(),
};
