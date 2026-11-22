// Scripts loaded on first use, not at page load. `ui` holds the badge and the toast. `page` holds the rare page commands. `text` records typed text and writes it back for `.`. `editor` hands a field's text to the external editor and writes the result back. `site_actions` holds the handlers of commands that site rows bind to keys. `grab` drives a drag from the keys. `item` moves through the items of a result page for `page.item`. `item_act` acts on the current item. `tree` moves and folds through nested items for `page.tree`. `next_page` finds the next page or more to load for `page.follow`. Each name is a file `<name>.js` in the extension.

import type { Mode } from "./command.ts";

export const BUNDLE_NAMES = ["hints", "caret", "whichkey", "cmdline", "ui", "page", "text", "editor", "site_actions", "grab", "item", "item_act", "tree", "next_page"] as const;
export type BundleName = (typeof BUNDLE_NAMES)[number];

// The modes whose keys go to a sink, and the bundle that registers it.
export const BUNDLE_FOR_MODE: Partial<Record<Mode, BundleName>> = { hint: "hints", caret: "caret", visual: "caret", visual_line: "caret", cmdline: "cmdline", grab: "grab" };

// A handler of the `whichkey` bundle, not a command. Only the background sends it, so it takes no argument.
export const MEDIA_PANEL_HANDLER = "whichkey.media_panel";

export const is_bundle_name = (value: unknown): value is BundleName => (BUNDLE_NAMES as readonly unknown[]).includes(value);
