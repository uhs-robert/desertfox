// WebExtension match patterns: `<all_urls>` or `scheme://host/path` with `*` wildcards, and the column rules of the site table that matches rows by them.
// Snippets use them to name the sites they run on, so a URL is parsed, never sliced with a regex:
// "https://evil.com?x=@a.example.com/" must not pass for the host a.example.com.

import type { BindingTable, Settings } from "./settings_table.ts";

const PATTERN_PARTS = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/;

const escape_regex = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export function matches_pattern(pattern: string, url: string): boolean {
  if (pattern === "<all_urls>") return /^(https?|file|ftp):/.test(url);
  const parts = PATTERN_PARTS.exec(pattern);
  if (!parts) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, path] = parts as unknown as [string, string, string, string];
  const url_scheme = target.protocol.slice(0, -1);

  const scheme_ok = scheme === "*" ? url_scheme === "http" || url_scheme === "https" : scheme === url_scheme;
  if (!scheme_ok) return false;

  const bare_host = target.hostname;
  const host_ok =
    host === "*" ||
    (host.startsWith("*.") ? bare_host === host.slice(2) || bare_host.endsWith(host.slice(1)) : bare_host === host);
  if (!host_ok) return false;

  return new RegExp(`^${path.split("*").map(escape_regex).join(".*")}$`).test(target.pathname + target.search);
}

// One regex source over `location.href` for a list of patterns, so the content script holds no pattern parser.
// It must agree with `matches_pattern` on every URL, and it must never build a regex that throws.
// A pattern that does not parse is dropped, as there. So is one that `matches_pattern` can never match:
// a `*` inside a host label, a port in the host, or a `#` in the path, since it compares the bare host and never sees a fragment.
// `[^#]` stands where the path wildcard sits, for the same reason.
export function match_regex_source(patterns: readonly string[]): string | undefined {
  const alternatives: string[] = [];
  for (const pattern of patterns) {
    if (pattern === "<all_urls>") {
      alternatives.push("(?:https?|file|ftp):.*");
      continue;
    }
    const parts = PATTERN_PARTS.exec(pattern);
    if (!parts) continue;
    const [, scheme, host, path] = parts as unknown as [string, string, string, string];
    const host_label = host.startsWith("*.") ? host.slice(2) : host;
    if (host !== "*" && (host_label.includes("*") || (host_label.includes(":") && !host_label.startsWith("[")))) continue;
    if (path.includes("#")) continue;
    const scheme_source = scheme === "*" ? "https?" : scheme;
    const host_source =
      host === "*" ? "[^/?#]*" : host.startsWith("*.") ? `(?:[^/?#@:]*\\.)?${escape_regex(host.slice(2))}` : escape_regex(host);
    const path_source = path.split("*").map(escape_regex).join("[^#]*");
    // Userinfo and port are part of the href and not of the host.
    alternatives.push(`${scheme_source}://(?:[^/?#@]*@)?${host_source}${host === "*" ? "" : "(?::\\d*)?"}${path_source}(?:#.*)?`);
  }
  return alternatives.length > 0 ? `^(?:${alternatives.join("|")})$` : undefined;
}

// True only when no URL can match both patterns, judged by host alone. Anything unparsable or `<all_urls>` counts as overlapping, so a caller that warns errs toward warning.
export function hosts_disjoint(left: string, right: string): boolean {
  const left_parts = PATTERN_PARTS.exec(left);
  const right_parts = PATTERN_PARTS.exec(right);
  if (!left_parts || !right_parts) return false;
  const [left_host, right_host] = [left_parts[2]!.toLowerCase(), right_parts[2]!.toLowerCase()];
  if (left_host === "*" || right_host === "*") return false;
  const [left_wild, right_wild] = [left_host.startsWith("*."), right_host.startsWith("*.")];
  const [left_base, right_base] = [left_wild ? left_host.slice(2) : left_host, right_wild ? right_host.slice(2) : right_host];
  const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);
  return !((left_wild && under(right_base, left_base)) || (right_wild && under(left_base, right_base)) || left_base === right_base);
}

// A frame passes its own address and the tab's, so an embed on a ruled page follows the rule too. A stored regex that does not compile matches nothing, so keys keep working.
export function matches_any_address(source: string | undefined, addresses: readonly (string | undefined)[]): boolean {
  if (source === undefined) return false;
  try {
    const pattern = new RegExp(source);
    return addresses.some((address) => address !== undefined && pattern.test(address));
  } catch {
    return false;
  }
}

// The site table (`site_rules`) resolves each column on its own: the first matching row that sets a column decides it.
// `pass` and `only` form one column, the key rule. Each per-site setting is a column of its own in `values`.
// `bind` is the one column that merges key by key: for each key, the first matching row that binds it decides. Its keys are the written sequences in a row, and the normalized sequences once compiled.
// `modes` is the other merging column: a site mode is decided whole, by the first matching row that has its name.
export type SiteModeColumn<Bind = unknown> = { label: string; bind: Readonly<Record<string, Bind>> };
export type SiteColumns<Keys, Bind = unknown> = { off?: boolean; keys?: Keys; bind?: Readonly<Record<string, Bind>>; modes?: Readonly<Record<string, SiteModeColumn<Bind>>>; values?: Readonly<Record<string, unknown>> };
export type ResolvedSiteColumns<Keys, Bind = unknown> = { off?: boolean; keys?: Keys; bind?: Record<string, Bind>; modes?: Record<string, SiteModeColumn<Bind>>; values: Record<string, unknown> };

// `rows` are the rows that match the page, in table order.
export function resolve_site_columns<Keys, Bind = unknown>(rows: readonly SiteColumns<Keys, Bind>[]): ResolvedSiteColumns<Keys, Bind> {
  const resolved: ResolvedSiteColumns<Keys, Bind> = { values: {} };
  for (const row of rows) {
    if (resolved.off === undefined && row.off !== undefined) resolved.off = row.off;
    if (resolved.keys === undefined && row.keys !== undefined) resolved.keys = row.keys;
    for (const [key, binding] of Object.entries(row.bind ?? {})) {
      resolved.bind ??= {};
      if (!Object.hasOwn(resolved.bind, key)) resolved.bind[key] = binding;
    }
    for (const [name, mode] of Object.entries(row.modes ?? {})) {
      resolved.modes ??= {};
      if (!Object.hasOwn(resolved.modes, name)) resolved.modes[name] = mode;
    }
    for (const [name, value] of Object.entries(row.values ?? {})) if (!Object.hasOwn(resolved.values, name)) resolved.values[name] = value;
  }
  return resolved;
}

export type SiteRuleRow = Settings["site_rules"][number];
// Every bind table a row holds: its own and one per mode. `scope` is the words a problem puts before "bind".
export const bind_tables_of = (row: SiteRuleRow): { scope: string; table: BindingTable }[] => [
  ...(row.bind === undefined ? [] : [{ scope: "", table: row.bind }]),
  ...Object.entries(row.modes ?? {}).map(([name, mode]) => ({ scope: `mode "${name}" `, table: mode.bind })),
];

export type SiteRowKeys = { pass: string } | { only: string };

const SITE_ROW_FIELDS = new Set(["site", "off", "pass", "only", "bind", "modes"]);

// A row's columns, with an unset column left out. A row that sets nothing but `site` is off: older configs and the popup wrote that shape.
export function site_row_columns(row: SiteRuleRow): SiteColumns<SiteRowKeys> {
  const values = Object.fromEntries(Object.entries(row).filter(([field, value]) => !SITE_ROW_FIELDS.has(field) && value !== undefined));
  const keys: SiteRowKeys | undefined = row.pass !== undefined ? { pass: row.pass } : row.only !== undefined ? { only: row.only } : undefined;
  const has_values = Object.keys(values).length > 0;
  const off = row.off ?? (keys === undefined && !has_values && row.bind === undefined && row.modes === undefined ? true : undefined);
  return { ...(off === undefined ? {} : { off }), ...(keys === undefined ? {} : { keys }), ...(row.bind === undefined ? {} : { bind: row.bind }), ...(row.modes === undefined ? {} : { modes: row.modes }), ...(has_values ? { values } : {}) };
}
