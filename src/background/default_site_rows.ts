// Site rows that ship with DesertFox. The compiler appends them after the user's rows, so a user row wins column by column, and `bind` merges key by key. A row has a name, and the `default_site_rows_off` setting turns every row of that name off. One name can cover several rows when a site has several address forms.

import type { SiteRuleRow } from "../shared/match_pattern.ts";
import type { BindingTable } from "../shared/settings_table.ts";

export type DefaultSiteRow = { name: string; row: SiteRuleRow };

// Sheets reads the key code of a keydown and ignores the rest, so hjkl send the arrow keys to its grid editor.
const SHEETS_TARGET = "#waffle-rich-text-editor";
const arrow = (key: string, key_code: number): BindingTable[string] => ({ id: "page.send_key", args: { key, key_code, target: SHEETS_TARGET } });
const SHEETS_BIND: BindingTable = { h: arrow("ArrowLeft", 37), j: arrow("ArrowDown", 40), k: arrow("ArrowUp", 38), l: arrow("ArrowRight", 39) };

// The second pattern is the address form of a Google Workspace domain.
export const DEFAULT_SITE_ROWS: readonly DefaultSiteRow[] = [
  { name: "sheets", row: { site: "https://docs.google.com/spreadsheets/*", bind: SHEETS_BIND } },
  { name: "sheets", row: { site: "https://docs.google.com/a/*/spreadsheets/*", bind: SHEETS_BIND } },
];

// A row whose commands the registry lacks is left out without a warning: the user did not write it and cannot fix it. The real registry has them all, which a test checks.
export const default_rows_left_on = (off_names: readonly string[], is_command: (id: string) => boolean): SiteRuleRow[] =>
  DEFAULT_SITE_ROWS.filter(({ name, row }) => !off_names.includes(name) && Object.values(row.bind ?? {}).every(({ id }) => is_command(id))).map(({ row }) => row);
