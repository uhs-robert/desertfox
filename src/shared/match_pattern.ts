// WebExtension match patterns: `<all_urls>` or `scheme://host/path` with `*` wildcards, and the column rules of the site table that matches rows by them.
// Snippets use them to name the sites they run on, so a URL is parsed, never sliced with a regex:
// "https://evil.com?x=@a.example.com/" must not pass for the host a.example.com.

import type { Settings } from "./settings_table.ts";

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
export type SiteColumns<Keys> = { off?: boolean; keys?: Keys; values?: Readonly<Record<string, unknown>> };
export type ResolvedSiteColumns<Keys> = { off?: boolean; keys?: Keys; values: Record<string, unknown> };

// `rows` are the rows that match the page, in table order.
export function resolve_site_columns<Keys>(rows: readonly SiteColumns<Keys>[]): ResolvedSiteColumns<Keys> {
  const resolved: ResolvedSiteColumns<Keys> = { values: {} };
  for (const row of rows) {
    if (resolved.off === undefined && row.off !== undefined) resolved.off = row.off;
    if (resolved.keys === undefined && row.keys !== undefined) resolved.keys = row.keys;
    for (const [name, value] of Object.entries(row.values ?? {})) if (!Object.hasOwn(resolved.values, name)) resolved.values[name] = value;
  }
  return resolved;
}

export type SiteRuleRow = Settings["site_rules"][number];
export type SiteRowKeys = { pass: string } | { only: string };

const SITE_ROW_FIELDS = new Set(["site", "off", "pass", "only"]);

// A row's columns, with an unset column left out. A row that sets nothing but `site` is off: older configs and the popup wrote that shape.
export function site_row_columns(row: SiteRuleRow): SiteColumns<SiteRowKeys> {
  const values = Object.fromEntries(Object.entries(row).filter(([field, value]) => !SITE_ROW_FIELDS.has(field) && value !== undefined));
  const keys: SiteRowKeys | undefined = row.pass !== undefined ? { pass: row.pass } : row.only !== undefined ? { only: row.only } : undefined;
  const has_values = Object.keys(values).length > 0;
  const off = row.off ?? (keys === undefined && !has_values ? true : undefined);
  return { ...(off === undefined ? {} : { off }), ...(keys === undefined ? {} : { keys }), ...(has_values ? { values } : {}) };
}
