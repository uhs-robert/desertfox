// Paints the selection in the mode's configured colors, in place of the page's own ::selection colors.
// The colors are in the compiled keymap in storage, which the bundle reads itself so the host API stays small.

import { COMPILED_KEYMAP_STORAGE_KEY } from "../../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../shared/prefix_tree.ts";
import type { ColorPair } from "../../shared/mode_colors.ts";
import type { TextTree } from "./text_model.ts";

// A document rule does not reach into a shadow root or a frame, so each tree with text gets its own style.
const styles = new Map<TextTree, HTMLStyleElement>();
// A read that finishes after a newer call or after clear_selection_colors is dropped.
let latest_call = 0;

const rule = ([background, text]: ColorPair) => `::selection{background:${background} !important;color:${text} !important}`;

export async function apply_selection_colors(mode: "caret" | "visual", trees: TextTree[]): Promise<void> {
  const this_call = ++latest_call;
  const stored = await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY);
  const colors = (stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined)?.mode_colors?.[mode];
  if (this_call !== latest_call || !colors) return;
  for (const tree of trees) {
    const in_document = tree.nodeType === Node.DOCUMENT_NODE;
    const style = styles.get(tree) ?? (in_document ? (tree as Document) : (tree as ShadowRoot).ownerDocument).createElement("style");
    style.textContent = `${rule(colors.dark)}@media(prefers-color-scheme:light){${rule(colors.light)}}`;
    (in_document ? (tree as Document).documentElement : tree).append(style);
    styles.set(tree, style);
  }
}

export function clear_selection_colors(): void {
  latest_call++;
  for (const style of styles.values()) style.remove();
  styles.clear();
}
