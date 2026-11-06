// Paints the find highlights and the selection in the stored theme's colors, in place of the page's own.
// The page document has no `--desertfox-*` tokens, so the colors are read from the stored theme and written as literals.
// The bundle reads storage itself so the host API stays small.

import { THEME_STORAGE_KEY } from "../../shared/theme/apply.ts";
import type { StoredTheme } from "../../shared/theme/apply.ts";
import type { RoleColors } from "../../shared/theme/roles.ts";
import type { FindColors } from "./find_paint.ts";
import type { TextTree } from "./text_model.ts";
import type { CaretMode } from "./selection_state.ts";

// A document rule does not reach into a shadow root or a frame, so each tree with text gets its own style.
const styles = new Map<TextTree, HTMLStyleElement>();
// A read that finishes after a newer call or after clear_selection_colors is dropped.
let latest_call = 0;

// Undefined until the background has published a theme.
export async function stored_theme(): Promise<StoredTheme | undefined> {
  const stored = await browser.storage.local.get(THEME_STORAGE_KEY);
  return stored[THEME_STORAGE_KEY] as StoredTheme | undefined;
}

export function find_colors_of({ dark, light }: StoredTheme): FindColors {
  return {
    all: { dark: [dark.search_bg, dark.search_fg], light: [light.search_bg, light.search_fg] },
    current: { dark: [dark.search_current_bg, dark.search_current_fg], light: [light.search_current_bg, light.search_current_fg] },
  };
}

// Both visual modes tint the text and leave its color. Caret mode keeps one visible cell, so the caret does not vanish into the page.
const rule = (mode: CaretMode, colors: RoleColors) =>
  mode === "caret"
    ? `::selection{background:${colors.mode_caret} !important;color:${colors.bg_core} !important}`
    : `::selection{background:${colors.selection} !important}`;

export async function apply_selection_colors(mode: CaretMode, trees: TextTree[]): Promise<void> {
  const this_call = ++latest_call;
  const theme = await stored_theme();
  if (this_call !== latest_call || !theme) return;
  for (const tree of trees) {
    // A tree that died during the await throws on any use, and the later trees still need their style.
    try {
      const in_document = tree.nodeType === Node.DOCUMENT_NODE;
      const style = styles.get(tree) ?? (in_document ? (tree as Document) : (tree as ShadowRoot).ownerDocument).createElement("style");
      style.setAttribute("data-desertfox", "");
      style.textContent = `${rule(mode, theme.dark)}@media(prefers-color-scheme:light){${rule(mode, theme.light)}}`;
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
