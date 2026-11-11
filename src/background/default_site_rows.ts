// Site rows that ship with DesertFox. The compiler appends them after the user's rows, so a user row wins column by column, and `bind` merges key by key. A row has a name, and the `default_site_rows_off` setting turns every row of that name off. One name can cover several rows when a site has several address forms.

import type { SiteRuleRow } from "../shared/match_pattern.ts";
import type { DEFAULT_SITE_ROW_NAMES } from "../shared/table_constants.ts";
import type { BindingTable } from "../shared/settings_table.ts";

export type DefaultSiteRow = { name: (typeof DEFAULT_SITE_ROW_NAMES)[number]; row: SiteRuleRow };

// Sheets reads the key code of a keydown and ignores the rest, so hjkl send the arrow keys to its grid editor.
const SHEETS_TARGET = "#waffle-rich-text-editor";
const arrow = (key: string, key_code: number, ctrl = false): BindingTable[string] => ({ id: "page.send_key", args: { key, key_code, target: SHEETS_TARGET, ...(ctrl ? { ctrl } : {}) } });
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
  x: { id: "page.clipboard", args: { action: "cut", target: SHEETS_TARGET } },
  p: { id: "page.clipboard", args: { action: "paste", target: SHEETS_TARGET } },
};
// Select all, Cut and Paste are Sheets' own, so url.increment must not take <C-a> and <C-x> and mode.pass_next must not take <C-v> on Sheets. A user Sheets row that sets `pass` replaces this column, so it must list all three keys to keep them. A row that sets `only` replaces it too, and there a key left out of `only` goes to the page, so it must leave all three keys out.
const SHEETS_PASS = "<C-a> <C-x> <C-v>";

// Sheets cancels a cell edit on Escape, so `escape_to_page` lets its own handler see the key.
// The second pattern is the address form of a Google Workspace domain.
export const DEFAULT_SITE_ROWS: readonly DefaultSiteRow[] = [
  { name: "sheets", row: { site: "https://docs.google.com/spreadsheets/*", bind: SHEETS_BIND, pass: SHEETS_PASS, escape_to_page: true } },
  { name: "sheets", row: { site: "https://docs.google.com/a/*/spreadsheets/*", bind: SHEETS_BIND, pass: SHEETS_PASS, escape_to_page: true } },
];

export const default_rows_left_on = (rows: readonly DefaultSiteRow[], off_names: readonly string[]): SiteRuleRow[] => rows.filter(({ name }) => !off_names.includes(name)).map(({ row }) => row);
