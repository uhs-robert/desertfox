// Scripts loaded on first use, not at page load. `ui` holds the badge and the toast. `page` holds the rare page commands. `text` records typed text and writes it back for `.`. `editor` hands a field's text to the external editor and writes the result back. `site_actions` holds the handlers of commands that site rows bind to keys. `grab` drives a drag from the keys. Each name is a file `<name>.js` in the extension.

import type { Mode } from "./command.ts";

export const BUNDLE_NAMES = ["hints", "caret", "whichkey", "cmdline", "ui", "page", "text", "editor", "site_actions", "grab"] as const;
export type BundleName = (typeof BUNDLE_NAMES)[number];

// The modes whose keys go to a sink, and the bundle that registers it.
export const BUNDLE_FOR_MODE: Partial<Record<Mode, BundleName>> = { hint: "hints", caret: "caret", visual: "caret", visual_line: "caret", cmdline: "cmdline", grab: "grab" };

export const is_bundle_name = (value: unknown): value is BundleName => (BUNDLE_NAMES as readonly unknown[]).includes(value);

// Extension pages (help, settings, new tab) cannot take an injected bundle, so the build writes a script tag for each bundle there. This lists the bundles it leaves out, each with its reason. media.js, quality.js and quality_probe.js are not in BUNDLE_NAMES: the background injects them into web pages, so they never reach this list.
export const EXTENSION_PAGE_SKIPPED: Partial<Record<BundleName, string>> = {};
