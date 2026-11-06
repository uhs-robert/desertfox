// The site of a tab: the key that groups tabs of one site. Pure, so the background commands and the sidebar share it.
// Each subdomain is its own site (`docs.github.com` is not under `github.com`), so no public suffix list is needed.

export type SiteKind = "host" | "ip" | "local" | "file" | "internal" | "extension" | "other";

export type SiteKey = { key: string; label: string; kind: SiteKind };

const HOST_SCHEMES = new Set(["http:", "https:", "ftp:", "ws:", "wss:"]);
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const OTHER: SiteKey = { key: "other:", label: "Other pages", kind: "other" };

export function site_key(url: string): SiteKey {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return OTHER;
  }
  const { protocol } = parsed;
  if (HOST_SCHEMES.has(protocol)) return host_key(parsed.hostname);
  if (protocol === "file:") return { key: "file:", label: "Local files", kind: "file" };
  if (protocol === "moz-extension:") {
    const uuid = parsed.hostname.toLowerCase();
    return uuid === "" ? OTHER : { key: `moz-extension:${uuid}`, label: `Extension ${uuid}`, kind: "extension" };
  }
  if (protocol === "about:") {
    // The reader page is its own site only in name: it shows the page in `url`.
    const wrapped = parsed.pathname === "reader" ? parsed.searchParams.get("url") : null;
    return wrapped === null ? { key: "about:", label: "Firefox pages", kind: "internal" } : site_key(wrapped);
  }
  if (protocol === "view-source:") return site_key(url.slice("view-source:".length));
  return OTHER;
}

function host_key(hostname: string): SiteKey {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return OTHER;
  if (host.startsWith("[") || IPV4.test(host)) return { key: host, label: host, kind: "ip" };
  const kind = host === "localhost" || host.endsWith(".localhost") ? "local" : "host";
  // Only one `www.` folds, and only when a dot remains: `www.com` is a host of its own.
  const folded = host.startsWith("www.") && host.indexOf(".", 4) !== -1 ? host.slice(4) : host;
  return { key: folded, label: folded, kind };
}
