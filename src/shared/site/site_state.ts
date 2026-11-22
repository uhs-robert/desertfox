// What the popup shows and writes for one site: the pattern "Disable on this site" uses, the site's state, and the row changes. Pure, so the popup and the background share it.

import { matches_pattern, resolve_site_columns, site_row_columns, type ResolvedSiteColumns, type SiteRowKeys, type SiteRuleRow } from "../match_pattern.ts";

// The match pattern "Disable on this site" writes: the host without a leading `www.`, with its subdomains. Only web pages have one.
export function site_pattern(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return undefined;
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") return undefined;
  const bare = address.hostname.replace(/^www\.(?=.+\.)/, "");
  return bare === "" ? undefined : `*://*.${bare}/*`;
}

// `disabled` is an off row this popup writes, which a click can remove. `config` is a page whose off column another row decides, so only editing the settings changes it.
// `rule` words what the matching rows do to this page, and is absent when no row matches.
export type SiteState = { kind: "unavailable" } | { kind: "enabled" | "disabled" | "config"; pattern: string; rule?: string };

// The row the popup writes: a site that is off and nothing else. Any other column makes the row the user's,
// so it checks every key of the row instead of a column list that a new column would slip past.
const is_popup_shaped = (row: SiteRuleRow): boolean =>
  (row.off === true || row.off === undefined) && Object.entries(row).every(([name, value]) => name === "site" || name === "off" || value === undefined);

const is_popup_row = (pattern: string) => (row: SiteRuleRow): boolean => row.site === pattern && is_popup_shaped(row);

const columns_at = (rows: readonly SiteRuleRow[], url: string): ResolvedSiteColumns<SiteRowKeys> =>
  resolve_site_columns(rows.filter((row) => matches_pattern(row.site, url)).map(site_row_columns));

const key_count = (keys: string): number => keys.split(/\s+/).filter((word) => word !== "").length;
const plural = (count: number): string => `${count} ${count === 1 ? "key" : "keys"}`;

// "all off", or what is set among "on", the key rule and the per-site values, for example "on, pass 3 keys".
export function describe_columns(columns: ResolvedSiteColumns<SiteRowKeys>): string | undefined {
  if (columns.off === true) return "all off";
  const keys = columns.keys === undefined ? [] : ["pass" in columns.keys ? `pass ${plural(key_count(columns.keys.pass))}` : `only ${plural(key_count(columns.keys.only))}`];
  const parts = [...(columns.off === false ? ["on"] : []), ...keys, ...Object.entries(columns.values).map(([name, value]) => `${name} ${String(value)}`)];
  return parts.length > 0 ? parts.join(", ") : undefined;
}

// The popup can turn a site off only while no row sets the off column: its appended row then decides it.
// It can turn a site on again only while a popup row for the pattern decides the column and, without the popup rows, no row turns it off. `rules` are the rules in force.
export function site_state(url: string | undefined, rules: readonly SiteRuleRow[]): SiteState {
  const pattern = site_pattern(url);
  if (pattern === undefined || url === undefined) return { kind: "unavailable" };
  const columns = columns_at(rules, url);
  const rule = describe_columns(columns);
  const state = { pattern, ...(rule === undefined ? {} : { rule }) };
  if (columns.off === undefined) return { kind: "enabled", ...state };
  const own = is_popup_row(pattern);
  // Another row that sets off = false behind the popup row still lets Enable turn the site on.
  const popup_decides = columns.off && rules.some(own) && columns_at(rules.filter((row) => !own(row)), url).off !== true;
  return { kind: popup_decides ? "disabled" : "config", ...state };
}

// Whether `rules` turn the page at `url` off: the first matching row that sets the off column decides.
export const site_is_off = (rules: readonly SiteRuleRow[], url: string): boolean => columns_at(rules, url).off === true;

// The rows after a site is disabled or enabled, or undefined when nothing changes. Disabling appends an off row, and enabling removes every popup row for the pattern.
export function site_rows_after(rows: readonly SiteRuleRow[], pattern: string, action: "disable" | "enable"): SiteRuleRow[] | undefined {
  const own = is_popup_row(pattern);
  const listed = rows.some(own);
  if (action === "disable" ? listed : !listed) return undefined;
  return action === "disable" ? [...rows, { site: pattern, off: true }] : rows.filter((row) => !own(row));
}

// The popup rows of a list saved in the browser before the popup wrote settings.toml, which the file lacks. They go into the file on the popup's next write.
// The saved list's other rows are copies of file rows taken when the popup first wrote, so the file's own rows, edits since included, stand for them.
export function saved_popup_rows(file_rows: readonly SiteRuleRow[], saved: readonly SiteRuleRow[] | undefined): SiteRuleRow[] {
  return (saved ?? []).filter((row) => is_popup_shaped(row) && !file_rows.some((file_row) => is_popup_shaped(file_row) && file_row.site === row.site));
}
