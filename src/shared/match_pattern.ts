// WebExtension match patterns: `<all_urls>` or `scheme://host/path` with `*` wildcards.
// Snippets use them to name the sites they run on, so a URL is parsed, never sliced with a regex:
// "https://evil.com?x=@a.example.com/" must not pass for the host a.example.com.

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

export function is_ignored_site(patterns: readonly string[], url: string): boolean {
  return patterns.some((pattern) => matches_pattern(pattern, url));
}
