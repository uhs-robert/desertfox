// Drops tracking parameters from a web address before it is copied, shared by the page copy (`handlers/copy.ts`) and the hints bundle.
// Pure and import-free, so both bundles can use it without growing content.js.

// A pattern is a parameter name, or a prefix before a final `*`. Names compare decoded and in lowercase, so `utm%5Fsource` matches `utm_*`.
const matches_any = (name: string, patterns: readonly string[]): boolean => {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {}
  const lower = decoded.toLowerCase();
  return patterns.some((pattern) => {
    const wanted = pattern.toLowerCase();
    return wanted.endsWith("*") ? lower.startsWith(wanted.slice(0, -1)) : lower === wanted;
  });
};

// The query is cut apart as text, not through `URLSearchParams`, which would rewrite the encoding and the order of the parameters that stay.
export function strip_tracking(address: string, patterns: readonly string[]): string {
  if (patterns.length === 0 || !/^https?:\/\//i.test(address) || !URL.canParse(address)) return address;
  const hash_at = address.indexOf("#");
  const fragment = hash_at < 0 ? "" : address.slice(hash_at);
  const before_fragment = hash_at < 0 ? address : address.slice(0, hash_at);
  const query_at = before_fragment.indexOf("?");
  if (query_at < 0) return address;
  const kept = before_fragment
    .slice(query_at + 1)
    .split("&")
    .filter((part) => !matches_any(part.split("=")[0]!, patterns));
  return before_fragment.slice(0, query_at) + (kept.length > 0 ? "?" + kept.join("&") : "") + fragment;
}
