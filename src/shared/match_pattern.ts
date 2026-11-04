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

// One regex source over `location.href` for a list of patterns, so the content script holds no pattern parser.
// It must agree with `matches_pattern` on every URL. A pattern that does not parse is dropped, as there.
// `[^#]` stands where the path wildcard sits, because `matches_pattern` never looks at the fragment.
export function ignore_regex_source(patterns: readonly string[]): string | undefined {
  const alternatives: string[] = [];
  for (const pattern of patterns) {
    if (pattern === "<all_urls>") {
      alternatives.push("(?:https?|file|ftp):.*");
      continue;
    }
    const parts = PATTERN_PARTS.exec(pattern);
    if (!parts) continue;
    const [, scheme, host, path] = parts as unknown as [string, string, string, string];
    const scheme_source = scheme === "*" ? "https?" : scheme;
    const host_source =
      host === "*" ? "[^/?#]*" : host.startsWith("*.") ? `(?:[^/?#@:]*\\.)?${escape_regex(host.slice(2))}` : escape_regex(host);
    const path_source = path.split("*").map(escape_regex).join("[^#]*");
    // Userinfo and port are part of the href and not of the host.
    alternatives.push(`${scheme_source}://(?:[^/?#@]*@)?${host_source}${host === "*" ? "" : "(?::\\d*)?"}${path_source}(?:#.*)?`);
  }
  return alternatives.length > 0 ? `^(?:${alternatives.join("|")})$` : undefined;
}
