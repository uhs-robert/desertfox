// Site rows that ship with DesertFox. The compiler appends them after the user's rows, so a user row wins column by column, and `bind` merges key by key. A row has a name, and the `default_site_rows_off` setting turns every row of that name off. One name can cover several rows when a site has several address forms.

import type { SiteRuleRow } from "../shared/match_pattern.ts";
import type { DEFAULT_SITE_ROW_NAMES } from "../shared/table_constants.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { BindingTable, SiteModeTable } from "../shared/settings_table.ts";

export type DefaultSiteRow = { name: (typeof DEFAULT_SITE_ROW_NAMES)[number]; row: SiteRuleRow };

// Sheets reads the key code of a keydown and ignores the rest, so hjkl send the arrow keys to its grid editor.
const SHEETS_TARGET = "#waffle-rich-text-editor";
const arrow = (key: string, key_code: number, ctrl = false, shift = false): BoundInvocation => ({ id: "page.send_key", args: { key, key_code, target: SHEETS_TARGET, ...(ctrl ? { ctrl } : {}), ...(shift ? { shift } : {}) } });
const clipboard = (action: "cut" | "copy" | "paste"): BoundInvocation => ({ id: "page.clipboard", args: { action, target: SHEETS_TARGET } });
const VISUAL_OFF: BoundInvocation = { id: "mode.site", args: { name: "off" } };
const VISUAL_ON: BoundInvocation = { id: "mode.site", args: { name: "visual" } };
const SHEETS_BIND: BindingTable = {
  h: arrow("ArrowLeft", 37),
  j: arrow("ArrowDown", 40),
  k: arrow("ArrowUp", 38),
  l: arrow("ArrowRight", 39),
  // Ctrl+arrow jumps to the edge of the data, Ctrl+Home to A1.
  gg: arrow("Home", 36, true),
  "<C-h>": arrow("ArrowLeft", 37, true),
  "<C-j>": arrow("ArrowDown", 40, true),
  "<C-k>": arrow("ArrowUp", 38, true),
  "<C-l>": arrow("ArrowRight", 39, true),
  // A synthetic Ctrl+X or Ctrl+V does not cut or paste, so these keys run the page's clipboard action instead.
  x: clipboard("cut"),
  p: clipboard("paste"),
  // `y` copies the cell at all times, so it replaces the yank group on Sheets.
  y: clipboard("copy"),
  v: VISUAL_ON,
  V: VISUAL_ON,
  // Ctrl+End goes to the last cell of the data, and Home from there to column A of that row.
  G: [{ ...arrow("End", 35, true), label: "Bottom of column A", intent: "Go to column A of the last row with data." }, arrow("Home", 36)],
};
// VISUAL extends the selection: the same keys with Shift held, and the clipboard keys act on the range. Each clipboard key leaves the mode first, so a refused clipboard step cannot leave it stuck. Escape ends the mode through the site-mode exit policy and collapses nothing.
const SHEETS_VISUAL: SiteModeTable[string] = {
  label: "VISUAL",
  bind: {
    h: arrow("ArrowLeft", 37, false, true),
    j: arrow("ArrowDown", 40, false, true),
    k: arrow("ArrowUp", 38, false, true),
    l: arrow("ArrowRight", 39, false, true),
    gg: arrow("Home", 36, true, true),
    "<C-h>": arrow("ArrowLeft", 37, true, true),
    "<C-j>": arrow("ArrowDown", 40, true, true),
    "<C-k>": arrow("ArrowUp", 38, true, true),
    "<C-l>": arrow("ArrowRight", 39, true, true),
    G: [{ ...arrow("End", 35, true, true), label: "Extend to the last row", intent: "Extend the selection to the last row with data." }, arrow("Home", 36, false, true)],
    x: [VISUAL_OFF, clipboard("cut")],
    y: [VISUAL_OFF, clipboard("copy")],
    p: [VISUAL_OFF, clipboard("paste")],
  },
};
// Select all, Cut and Paste are Sheets' own, so url.increment must not take <C-a> and <C-x> and mode.pass_next must not take <C-v> on Sheets. A user Sheets row that sets `pass` replaces this column, so it must list all three keys to keep them. A row that sets `only` replaces it too, and there a key left out of `only` goes to the page, so it must leave `<C-a>` and `<C-x>` out. `only` always keeps `<C-v>` for the one-shot pass, so an `only` row cannot free it.
const SHEETS_PASS = "<C-a> <C-x> <C-v>";

// Sheets cancels a cell edit on Escape, so `escape_to_page` lets its own handler see the key.
// The cell editor stays focused, parked with no width, while a cell is only selected, so it counts as a field only once it has width. The id stands for the site: a rule on zero width alone would also catch the hidden field a web terminal types into.
// The second pattern is the address form of a Google Workspace domain.
// Google Maps pans on arrow keys, real or synthetic, only while its map element has focus. Maps focuses its search box as it loads, so `focus_on_load` hands the focus to the map in its place, and hjkl send arrows there. The guard leaves j and k to scroll the place panel when it has focus. The aria-label of the map is localized, so the selector skips it. The matcher cannot name every google.<country> host, so the rows cover google.com alone.
const MAPS_TARGET = 'div[role="application"][tabindex="0"]';
const map_arrow = (key: string, key_code: number): BoundInvocation => ({ id: "page.send_key", args: { key, key_code, target: MAPS_TARGET }, when_focus: MAPS_TARGET });
const MAPS_BIND: BindingTable = { h: map_arrow("ArrowLeft", 37), j: map_arrow("ArrowDown", 40), k: map_arrow("ArrowUp", 38), l: map_arrow("ArrowRight", 39) };

export const DEFAULT_SITE_ROWS: readonly DefaultSiteRow[] = [
  { name: "sheets", row: { site: "https://docs.google.com/spreadsheets/*", bind: SHEETS_BIND, modes: { visual: SHEETS_VISUAL }, pass: SHEETS_PASS, escape_to_page: true, editable_remove: [SHEETS_TARGET], editable_remove_unsized: true } },
  { name: "sheets", row: { site: "https://docs.google.com/a/*/spreadsheets/*", bind: SHEETS_BIND, modes: { visual: SHEETS_VISUAL }, pass: SHEETS_PASS, escape_to_page: true, editable_remove: [SHEETS_TARGET], editable_remove_unsized: true } },
  { name: "maps", row: { site: "https://www.google.com/maps*", bind: MAPS_BIND, focus_on_load: MAPS_TARGET } },
  { name: "maps", row: { site: "https://google.com/maps*", bind: MAPS_BIND, focus_on_load: MAPS_TARGET } },
];

export const default_rows_left_on = (rows: readonly DefaultSiteRow[], off_names: readonly string[]): DefaultSiteRow[] => rows.filter(({ name }) => !off_names.includes(name));
