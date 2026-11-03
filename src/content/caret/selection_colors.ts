// Paints the selection in the mode's configured colors, in place of the page's own ::selection colors.
// The colors are in the compiled keymap in storage, which the bundle reads itself so the host API stays small.

import { COMPILED_KEYMAP_STORAGE_KEY } from "../../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../shared/prefix_tree.ts";
import type { ColorPair } from "../../shared/mode_colors.ts";

let style: HTMLStyleElement | undefined;
// A read that finishes after a newer call or after clear_selection_colors is dropped.
let latest_call = 0;

const rule = ([background, text]: ColorPair) => `::selection{background:${background} !important;color:${text} !important}`;

export async function apply_selection_colors(mode: "caret" | "visual"): Promise<void> {
  const this_call = ++latest_call;
  const stored = await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY);
  const colors = (stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined)?.mode_colors?.[mode];
  if (this_call !== latest_call || !colors) return;
  style ??= document.createElement("style");
  style.textContent = `${rule(colors.dark)}@media(prefers-color-scheme:light){${rule(colors.light)}}`;
  document.documentElement.append(style);
}

export function clear_selection_colors(): void {
  latest_call++;
  style?.remove();
  style = undefined;
}
