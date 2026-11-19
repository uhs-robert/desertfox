// The `{site, pass}` rows of the "Let this site keep some keys" form. The form owns rows of exactly that shape, and no other column.

import { match_regex_source, matches_pattern, resolve_site_columns, site_row_columns, type SiteRuleRow } from "../shared/match_pattern.ts";
import { parse_sequence } from "../shared/keys/notation.ts";
import type { SiteKeysRequest, ToolbarAnswer } from "../shared/messages.ts";

const PATTERN_PARTS = /^(\*|https?):\/\/([^/]*)(\/.*)$/;

// A row of only `site` and `pass`. A row with a bind, a setting or `off` is the user's own and the form leaves it alone.
export const is_pass_shaped = (row: SiteRuleRow): boolean => row.pass !== undefined && Object.entries(row).every(([name, value]) => name === "site" || name === "pass" || value === undefined);

// The row of the form for `pattern`, if the file has one.
export const pass_row_for = (rows: readonly SiteRuleRow[], pattern: string): SiteRuleRow | undefined => rows.find((row) => row.site === pattern && is_pass_shaped(row));

// A row for the same pattern that sets the key column but is not the form's: `only`, or `pass` beside other columns.
export const own_key_row_for = (rows: readonly SiteRuleRow[], pattern: string): SiteRuleRow | undefined => rows.find((row) => row.site === pattern && !is_pass_shaped(row) && (row.pass !== undefined || row.only !== undefined));

// One address the pattern covers, to ask which rows decide it. Undefined for a pattern with a wildcard inside its host, which has no single address.
export function sample_address(pattern: string): string | undefined {
  const parts = PATTERN_PARTS.exec(pattern);
  if (parts === null) return undefined;
  const host = parts[2]!.replace(/^\*\./, "");
  if (host === "" || host.includes("*")) return undefined;
  return `${parts[1] === "*" ? "https" : parts[1]}://${host}${parts[3]!.replaceAll("*", "")}`;
}

// The words of a pass list, or the first problem in it.
export function pass_words(text: string): { words: string[] } | { problem: string } {
  const words = text.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return { problem: "Name at least one key." };
  for (const word of words) {
    const { error } = parse_sequence(word);
    if (error !== undefined) return { problem: `${word} ${error}` };
  }
  return { words: [...new Set(words)] };
}

// Why the form cannot own the key column of `pattern`: an earlier row decides it for the sample address, or a row of the user's own holds it.
export function key_column_refusal(rows: readonly SiteRuleRow[], pattern: string): string | undefined {
  const own = own_key_row_for(rows, pattern);
  if (own !== undefined) return `The rule for ${pattern} sets ${own.only !== undefined ? "only" : "pass"} with other fields. Edit it in settings.toml.`;
  const address = sample_address(pattern);
  if (address === undefined) return undefined;
  const form_row = pass_row_for(rows, pattern);
  const earlier = rows.slice(0, form_row === undefined ? rows.length : rows.indexOf(form_row)).find((row) => matches_pattern(row.site, address) && site_row_columns(row).keys !== undefined);
  return earlier === undefined ? undefined : `An earlier rule for ${earlier.site} already sets which keys pass here, so this one would never apply. Edit that rule in settings.toml.`;
}

// Whether the rules turn the site of `pattern` off, which wins over the keys it keeps.
export function site_is_off_for(rows: readonly SiteRuleRow[], pattern: string): boolean {
  const address = sample_address(pattern);
  return address !== undefined && resolve_site_columns(rows.filter((row) => matches_pattern(row.site, address)).map(site_row_columns)).off === true;
}

export type RowsChange = { rows: SiteRuleRow[] } | { refusal: string };

// The rows with `keys` kept for `pattern`: the form's row is replaced in place, or a new one is appended.
export function site_rows_with_pass(rows: readonly SiteRuleRow[], pattern: string, keys: string): RowsChange {
  const refusal = key_column_refusal(rows, pattern);
  if (refusal !== undefined) return { refusal };
  const row: SiteRuleRow = { site: pattern, pass: keys };
  const existing = pass_row_for(rows, pattern);
  return { rows: existing === undefined ? [...rows, row] : rows.map((candidate) => (candidate === existing ? row : candidate)) };
}

// The rows without the form's rows for `pattern`, or undefined when there are none.
export function site_rows_without_pass(rows: readonly SiteRuleRow[], pattern: string): SiteRuleRow[] | undefined {
  const kept = rows.filter((row) => !(row.site === pattern && is_pass_shaped(row)));
  return kept.length === rows.length ? undefined : kept;
}

export type SiteKeysDeps = {
  // Writes the change into settings.toml (`change_site_keys_in_file`) and gives back what became of the file as the end of the answer.
  // `unchanged`: a Remove found no row.
  change_site_keys: (pattern: string, keys: string | null) => Promise<{ note: string } | { unchanged: true }>;
};

// The form's one write. The request is checked here because a page script can send anything.
export async function answer_site_keys_request(request: SiteKeysRequest, deps: SiteKeysDeps): Promise<ToolbarAnswer> {
  if (typeof request.pattern !== "string" || match_regex_source([request.pattern]) === undefined) return { ok: false, message: "The site must be an address pattern such as *://*.example.com/*" };
  if (request.keys !== null) {
    const checked = typeof request.keys === "string" ? pass_words(request.keys) : { problem: "keys must be text or null" };
    if ("problem" in checked) return { ok: false, message: checked.problem };
  }
  try {
    const result = await deps.change_site_keys(request.pattern, request.keys);
    if ("unchanged" in result) return { ok: true, message: `No kept keys for ${request.pattern} to remove` };
    return { ok: true, message: `${request.keys === null ? "Keys no longer kept for" : "Keys kept for"} ${request.pattern}${result.note}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
