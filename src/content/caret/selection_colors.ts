// Paints the find highlights and the selection in the stored theme's colors, in place of the page's own.
// The page document has no `--desertfox-*` tokens, so the colors are read from the stored theme and written as literals.
// The bundle reads storage itself so the host API stays small.

import { THEME_STORAGE_KEY } from "../../shared/theme/apply.ts";
import type { StoredTheme } from "../../shared/theme/apply.ts";
import type { RoleColors } from "../../shared/theme/roles.ts";
import { CARET_NAMES } from "./find_paint.ts";
import type { FindColors } from "./find_paint.ts";
import { create_sheet_set } from "./adopted_sheets.ts";
import type { TextTree } from "./text_model.ts";
import type { CaretMode } from "./selection_state.ts";

const sheets = create_sheet_set();
// The text of the sheets in use, so a repaint can adopt them again without a storage read. Undefined outside a session.
let current_css: string | undefined;
// A read that finishes after a newer call or after clear_selection_colors is dropped.
let latest_call = 0;
// The trees of the last paint. A read that settles colors these, so a rebuild during the read still gets the sheet.
let painted_trees: TextTree[] = [];

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

// Both visual modes tint the text and leave its color. Caret mode colors its cell, a highlight, so the caret does not vanish into the page.
const rule = (mode: CaretMode, colors: RoleColors) =>
  mode === "caret" ? `::highlight(${CARET_NAMES.current}){background:${colors.mode_caret};color:${colors.bg_core}}` : `::selection{background:${colors.selection} !important}`;

export async function apply_selection_colors(mode: CaretMode): Promise<void> {
  const this_call = ++latest_call;
  const theme = await stored_theme();
  if (this_call !== latest_call || !theme) return;
  current_css = `${rule(mode, theme.dark)}@media(prefers-color-scheme:light){${rule(mode, theme.light)}}`;
  keep_selection_colors(painted_trees);
}

// The page may replace its adopted sheets at any time, so each paint of the selection checks that ours is still there.
export function keep_selection_colors(trees: TextTree[]): void {
  painted_trees = trees;
  if (current_css === undefined) return;
  for (const tree of trees) {
    // A tree that died during the await throws on any use, and the later trees still need their sheet.
    try {
      sheets.set(tree, current_css);
    } catch {}
  }
}

export function clear_selection_colors(): void {
  latest_call++;
  current_css = undefined;
  painted_trees = [];
  sheets.clear();
}
