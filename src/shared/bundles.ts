// Scripts loaded on first use, not at page load. `ui` holds the badge and the toast. `page` holds the rare page commands. `text` records typed text and writes it back for `.`. Each name is a file `<name>.js` in the extension.

import type { Mode } from "./command.ts";

export const BUNDLE_NAMES = ["hints", "caret", "whichkey", "cmdline", "ui", "page", "text"] as const;
export type BundleName = (typeof BUNDLE_NAMES)[number];

// How a refusal names a bundle that registers no handler for a command.
export const BUNDLE_LABELS: Record<BundleName, string> = { hints: "hints", caret: "caret mode", whichkey: "the which-key panel", cmdline: "the command line", ui: "the badge and toast", page: "the page commands", text: "the text recorder" };

// The modes whose keys go to a sink, and the bundle that registers it.
export const BUNDLE_FOR_MODE: Partial<Record<Mode, BundleName>> = { hint: "hints", caret: "caret", visual: "caret", visual_line: "caret", cmdline: "cmdline" };

export const is_bundle_name = (value: unknown): value is BundleName => (BUNDLE_NAMES as readonly unknown[]).includes(value);
