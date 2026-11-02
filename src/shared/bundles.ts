// Scripts loaded on first use, not at page load. Each name is a file `<name>.js` in the extension.

import type { Mode } from "./command.ts";

export const BUNDLE_NAMES = ["hints", "caret", "whichkey", "cmdline"] as const;
export type BundleName = (typeof BUNDLE_NAMES)[number];

// The modes whose keys go to a sink, and the bundle that registers it.
export const BUNDLE_FOR_MODE: Partial<Record<Mode, BundleName>> = { hint: "hints", caret: "caret", visual: "caret", cmdline: "cmdline" };

export const is_bundle_name = (value: unknown): value is BundleName => (BUNDLE_NAMES as readonly unknown[]).includes(value);
