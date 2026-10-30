// WebExtension match patterns, for `ignore_sites`: `<all_urls>` or `scheme://host/path` with `*` wildcards.

const PATTERN_PARTS = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/;

const escape_regex = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export function matches_pattern(pattern: string, url: string): boolean {
  if (pattern === "<all_urls>") return /^(https?|file|ftp):/.test(url);
  const parts = PATTERN_PARTS.exec(pattern);
  const target = /^([a-z]+):\/\/([^/]*)(\/.*)$/.exec(url);
  if (!parts || !target) return false;
  const [, scheme, host, path] = parts as unknown as [string, string, string, string];
  const [, url_scheme, url_host, url_path] = target as unknown as [string, string, string, string];

  const scheme_ok = scheme === "*" ? url_scheme === "http" || url_scheme === "https" : scheme === url_scheme;
  if (!scheme_ok) return false;

  const bare_host = url_host.replace(/:\d+$/, "");
  const host_ok =
    host === "*" ||
    (host.startsWith("*.") ? bare_host === host.slice(2) || bare_host.endsWith(host.slice(1)) : bare_host === host);
  if (!host_ok) return false;

  return new RegExp(`^${path.split("*").map(escape_regex).join(".*")}$`).test(url_path);
}

export function is_ignored_site(patterns: readonly string[], url: string): boolean {
  return patterns.some((pattern) => matches_pattern(pattern, url));
}
