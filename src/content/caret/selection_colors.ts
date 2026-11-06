// Paints the selection in the mode's configured colors, in place of the page's own ::selection colors.
// The colors are in the compiled keymap in storage, which the bundle reads itself so the host API stays small.

import { COMPILED_KEYMAP_STORAGE_KEY } from "../../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../shared/prefix_tree.ts";
import type { ColorPair, ModeColorMode } from "../../shared/mode_colors.ts";
import type { TextTree } from "./text_model.ts";

// A document rule does not reach into a shadow root or a frame, so each tree with text gets its own style.
const styles = new Map<TextTree, HTMLStyleElement>();
// A read that finishes after a newer call or after clear_selection_colors is dropped.
let latest_call = 0;

const rule = ([background, text]: ColorPair) => `::selection{background:${background} !important;color:${text} !important}`;

// The badge colors of a mode, dark and light. Undefined until the config has compiled.
export async function stored_mode_colors(mode: ModeColorMode): Promise<{ dark: ColorPair; light: ColorPair } | undefined> {
  const stored = await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY);
  return (stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined)?.mode_colors?.[mode];
}

export async function apply_selection_colors(mode: "caret" | "visual", trees: TextTree[]): Promise<void> {
  const this_call = ++latest_call;
  const colors = await stored_mode_colors(mode);
  if (this_call !== latest_call || !colors) return;
  for (const tree of trees) {
    // A tree that died during the await throws on any use, and the later trees still need their style.
    try {
      const in_document = tree.nodeType === Node.DOCUMENT_NODE;
      const style = styles.get(tree) ?? (in_document ? (tree as Document) : (tree as ShadowRoot).ownerDocument).createElement("style");
      style.setAttribute("data-desertfox", "");
      style.textContent = `${rule(colors.dark)}@media(prefers-color-scheme:light){${rule(colors.light)}}`;
      (in_document ? (tree as Document).documentElement : tree).append(style);
      styles.set(tree, style);
    } catch {}
  }
}

export function clear_selection_colors(): void {
  latest_call++;
  // The style of a removed frame is a dead object, and its remove() throws.
  for (const style of styles.values()) {
    try {
      style.remove();
    } catch {}
  }
  styles.clear();
}
