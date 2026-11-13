import { RuntimeRefusal } from "../shared/command.ts";
import { BUILT_IN_PAGE, BUILT_IN_QUERY } from "../shared/config.ts";
import type { SearchEngine } from "../shared/config.ts";
import { fill_template } from "../shared/engines/fill.ts";
import type { FillInput } from "../shared/engines/fill.ts";
import { parse_http_url, path_segments } from "../shared/engines/slots.ts";

// Pure URL math for the url and open commands. Each function returns
// undefined when the page has no sensible answer, and the caller refuses.


// Drops the query and fragment with the last path segment. A root path with a query or fragment loses only those.
function parent_once(page_url: string): string | undefined {
  const url = parse_http_url(page_url);
  if (!url) return undefined;
  const segments = path_segments(url);
  const has_extras = url.search !== "" || url.hash !== "";
  if (segments.length === 0 && !has_extras) return undefined;
  const kept = segments.slice(0, segments.length === 0 ? 0 : -1);
  return `${url.origin}/${kept.map((segment) => `${segment}/`).join("")}`;
}

export function parent_url(page_url: string, levels = 1): string | undefined {
  let current = page_url;
  for (let level = 0; level < levels; level++) {
    const next = parent_once(current);
    if (next === undefined) return level === 0 ? undefined : current;
    current = next;
  }
  return current;
}

export function root_url(page_url: string): string | undefined {
  const url = parse_http_url(page_url);
  return url ? `${url.origin}/` : undefined;
}

// Digits past this lose precision as a double, and runs this long are ids or timestamps, not page numbers.
const MAX_NUMBER_DIGITS = 15;
const MAX_NUMBER = 10 ** MAX_NUMBER_DIGITS - 1;
const PERCENT_ESCAPE = /%[0-9a-f]{2}/gi;

// Changes the last number in the path and query, so the host and fragment are left alone. Leading zeros keep their width.
// The edit works on the serialized href, so an empty `?` or `#` that the URL object drops from `search` and `hash` stays.
export function incremented_url(page_url: string, direction: "up" | "down", amount: number): string {
  const url = parse_http_url(page_url);
  if (!url) throw new RuntimeRefusal("This address cannot change its number");
  const href = url.href;
  const path_start = href.indexOf("/", href.indexOf("//") + 2);
  const hash_start = href.indexOf("#", path_start);
  const changeable_end = hash_start === -1 ? href.length : hash_start;
  const changeable = href.slice(path_start, changeable_end);
  // The escape digits in %20 are not a number, so they are masked before the search and the edit keeps the original text.
  const searchable = changeable.replace(PERCENT_ESCAPE, (escape) => "%".repeat(escape.length));
  const last = [...searchable.matchAll(/\d+/g)].at(-1);
  if (!last) throw new RuntimeRefusal("This address has no number");
  const digits = last[0];
  if (digits.length > MAX_NUMBER_DIGITS) throw new RuntimeRefusal(`The number ${digits} has more than ${MAX_NUMBER_DIGITS} digits`);
  if (amount > MAX_NUMBER) throw new RuntimeRefusal(`The amount ${amount} has more than ${MAX_NUMBER_DIGITS} digits`);
  const next = Number(digits) + (direction === "up" ? amount : -amount);
  if (next < 0) throw new RuntimeRefusal(`The number ${digits} cannot go below 0`);
  if (next > MAX_NUMBER) throw new RuntimeRefusal(`The number ${digits} cannot grow past ${MAX_NUMBER_DIGITS} digits`);
  const start = path_start + last.index;
  return href.slice(0, start) + String(next).padStart(digits.length, "0") + href.slice(start + digits.length);
}

// For typed text, which has no page behind it: a template that needs the page is refused.
export function engine_search_url(template: string, query: string): string {
  const filled = fill_template(template, { query });
  if (!filled.ok) throw new RuntimeRefusal(filled.message);
  return filled.url;
}

// Runs the named engine. When the page cannot fill its slots, the engine's fallback runs in its place, and so on down
// the chain. The build rejects loops, but the guard stays: the stored config can come from elsewhere.
export function engine_url(engines: Record<string, SearchEngine>, name: string, input: FillInput): string {
  const tried: string[] = [];
  for (let next: string | undefined = name; next !== undefined && !tried.includes(next); next = engines[next]?.fallback) {
    const engine = engines[next];
    if (!engine) throw new RuntimeRefusal(`No search engine named "${next}"`);
    tried.push(next);
    const filled = fill_template(engine.url, input);
    if (filled.ok) return filled.url;
    if (engine.fallback === undefined) throw new RuntimeRefusal(filled.message);
  }
  throw new RuntimeRefusal(`The fallbacks of search engine "${name}" loop`);
}

// Refusals are thrown: the router shows the message to the user.
// `desertfox` names the built-in new tab page, whose address only the browser knows. It is asked for only then.
export function home_page_url(home_page: string | undefined, built_in_url: () => string): string {
  if (!home_page) throw new RuntimeRefusal("set home_page in settings.toml");
  return home_page === BUILT_IN_PAGE ? `${built_in_url()}?${BUILT_IN_QUERY}` : home_page;
}

// The one allow-list of addresses DesertFox opens, from typed text, hints, bookmarks, quickmarks, history and sessions.
// An allow-list, so a scheme Firefox adds later stays closed until it is listed here.
const OPENABLE_SCHEMES = new Set(["http:", "https:", "ftp:", "mailto:", "tel:", "magnet:"]);
const WEB_SCHEMES = new Set(["http:", "https:"]);
const OWN_PAGE_SCHEME = "moz-extension:";

// The base of the extension's own pages (`browser.runtime.getURL("")`), asked for only when an address is one. Undefined when the request may not open them: a page sent it, so a link the page offers cannot reach the grant panel of the help page.
export type OwnPages = (() => string) | undefined;

// Why DesertFox does not open `url`, or undefined when it does. The URL parser reads the text the way Firefox will, so case, stray tabs and padding change nothing.
function unopenable_reason(url: string, own_pages: OwnPages): string | undefined {
  if (!URL.canParse(url)) return "This address does not parse";
  const parsed = new URL(url);
  const scheme = parsed.protocol;
  if (OPENABLE_SCHEMES.has(scheme)) return undefined;
  if (scheme === "about:" && parsed.pathname.toLowerCase() === "blank") return undefined;
  if (scheme === "view-source:") {
    const inner = parsed.href.slice(scheme.length);
    return URL.canParse(inner) && WEB_SCHEMES.has(new URL(inner).protocol) ? undefined : "DesertFox opens view-source: only for http and https addresses";
  }
  if (scheme === OWN_PAGE_SCHEME) {
    if (own_pages === undefined) return "A page cannot open DesertFox's own pages";
    return parsed.host.toLowerCase() === new URL(own_pages()).host.toLowerCase() ? undefined : "DesertFox does not open another extension's pages";
  }
  return `DesertFox does not open ${scheme} addresses`;
}

export const openable_url = (url: string, own_pages: OwnPages): boolean => unopenable_reason(url, own_pages) === undefined;

export function require_openable(url: string, own_pages: OwnPages): void {
  const reason = unopenable_reason(url, own_pages);
  if (reason !== undefined) throw new RuntimeRefusal(reason);
}

// Hosts on this machine or the local network rarely have a certificate, so they get http. Public IPs get https like domains.
const IP_OR_LOCAL_HOST = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]*:[0-9a-f:.]*\])(?::\d+)?(?:[/?#]\S*)?$/i;
const PRIVATE_IPV4 = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/;
const PRIVATE_IPV6 = /^\[(?:::1\]|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

function is_private_host(host: string): boolean {
  return host.toLowerCase() === "localhost" || PRIVATE_IPV4.test(host) || PRIVATE_IPV6.test(host);
}

// No whitespace anywhere, so prose like "TODO: fix thing" is not taken for a scheme.
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\S+$/i;
// A name with a port and no dot ("nas:8080") is a machine on the local network, unless the name is a scheme that links carry digits after.
const LABEL_WITH_PORT = /^(?!(?:tel|sms|mms|fax|callto|facetime|facetime-audio|skype|whatsapp|geo|magnet|urn|sip|sips|xmpp|irc|ircs|bitcoin):)[a-z0-9-]+:\d{1,5}(?:[/?#]\S*)?$/i;
const HOST_WITH_PORT = /^[^\s:/?#]+\.[^\s:/?#]+:\d+(?:[/?#]\S*)?$/;

// Any parsable scheme is taken as an address, and `url_target` then refuses one off the allow-list rather than search it. Prose with a colon searches.
function typed_url(text: string): string | undefined {
  const ip_or_local = IP_OR_LOCAL_HOST.exec(text);
  if (ip_or_local) return `${is_private_host(ip_or_local[1]!) ? "http" : "https"}://${text}`;
  if (LABEL_WITH_PORT.test(text)) return `http://${text}`;
  // Checked before the scheme parse: "example.com:8080" would otherwise parse as the scheme "example.com:".
  if (HOST_WITH_PORT.test(text)) return `https://${text}`;
  if (SCHEME_URL.test(text) && URL.canParse(text)) return text;
  const looks_like_domain = text.includes(".") && !/\s/.test(text);
  return looks_like_domain && URL.canParse(`https://${text}`) ? `https://${text}` : undefined;
}

// The one way to turn text a person typed or copied into something a tab can open.
// A bare address must get a scheme here: the tabs API resolves it against the extension's own origin.
export function url_target(
  text: string,
  default_engine: string,
  engines: Record<string, { url: string }>,
  own_pages: OwnPages,
): string {
  const trimmed = text.trim();
  if (trimmed === "") throw new RuntimeRefusal("No URL");
  const url = typed_url(trimmed);
  if (url !== undefined) {
    require_openable(url, own_pages);
    return url;
  }
  const engine = engines[default_engine];
  if (!engine) throw new RuntimeRefusal(`The text is not a URL and the default_engine setting names no search engine: "${default_engine}"`);
  return engine_search_url(engine.url, trimmed);
}

// An empty or missing engine means the user named none, so the default_engine setting decides.
export const search_engine_name = (given: unknown, default_engine: string): string => (typeof given === "string" && given !== "" ? given : default_engine);
