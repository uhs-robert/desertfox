// Pure URL math for the url, site and open commands. Each function returns
// undefined when the page has no sensible answer, and the caller refuses.

export const GOOGLE_SEARCH_URL = "https://www.google.com/search?q=";
const GITHUB_HOSTS = ["github.com", "www.github.com"];
const REDDIT_HOSTS = ["reddit.com", "www.reddit.com", "old.reddit.com"];
export const DEFAULT_SUBREDDIT = "all";
const QUERY_PLACEHOLDER = "%s";

function parse_http_url(page_url: string): URL | undefined {
  try {
    const url = new URL(page_url);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function path_segments(url: URL): string[] {
  return url.pathname.split("/").filter((segment) => segment !== "");
}

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

export function archive_url(page_url: string): string | undefined {
  return parse_http_url(page_url) ? `https://web.archive.org/web/${page_url}` : undefined;
}

export function isdown_url(page_url: string): string | undefined {
  const url = parse_http_url(page_url);
  return url ? `https://www.isitdownrightnow.com/${url.hostname}.html` : undefined;
}

export function translate_url(page_url: string): string | undefined {
  if (!parse_http_url(page_url)) return undefined;
  return `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(page_url)}`;
}

export function site_search_url(page_url: string, query: string): string | undefined {
  const url = parse_http_url(page_url);
  return url ? `${GOOGLE_SEARCH_URL}${encodeURIComponent(`site:${url.hostname} ${query}`)}` : undefined;
}

export function github_repo_of(page_url: string): { owner: string; repo: string } | undefined {
  const url = parse_http_url(page_url);
  if (!url || !GITHUB_HOSTS.includes(url.hostname)) return undefined;
  const [owner, repo] = path_segments(url);
  return owner && repo ? { owner, repo } : undefined;
}

export function repo_search_url(page_url: string, query: string): string | undefined {
  const found = github_repo_of(page_url);
  if (!found) return undefined;
  return `https://github.com/${found.owner}/${found.repo}/search?q=${encodeURIComponent(query)}&type=code`;
}

export function subreddit_of(page_url: string): string | undefined {
  const url = parse_http_url(page_url);
  if (!url || !REDDIT_HOSTS.includes(url.hostname)) return undefined;
  const [prefix, name] = path_segments(url);
  return prefix === "r" ? name : undefined;
}

// An explicit sub wins. The default "all" yields to the subreddit the page is on.
export function subreddit_search_url(page_url: string, query: string, sub: string): string {
  const chosen = sub === DEFAULT_SUBREDDIT ? (subreddit_of(page_url) ?? sub) : sub;
  return `https://www.reddit.com/r/${encodeURIComponent(chosen)}/search/?q=${encodeURIComponent(query)}&restrict_sr=1`;
}

export function engine_search_url(template: string, query: string): string {
  return template.split(QUERY_PLACEHOLDER).join(encodeURIComponent(query));
}

// Refusals are thrown: the router shows the message to the user.
export function home_page_url(home_page: string | undefined): string {
  if (!home_page) throw new Error("set home_page in settings.jsonc");
  return home_page;
}

const CLIPBOARD_URL_SCHEMES = ["http:", "https:", "ftp:", "file:"];
const HOST_WITH_PORT = /^(localhost|[^\s:/?#]+\.[^\s:/?#]+):\d+(?:[/?#]\S*)?$/;

// Other schemes (javascript:, data:) and text with a colon ("TODO: fix") are not worth opening, so they search.
function clipboard_url(text: string): string | undefined {
  // Checked first: "example.com:8080" would otherwise parse as the scheme "example.com:".
  const host_with_port = HOST_WITH_PORT.exec(text);
  if (host_with_port) return `${host_with_port[1] === "localhost" ? "http" : "https"}://${text}`;
  if (URL.canParse(text)) return CLIPBOARD_URL_SCHEMES.includes(new URL(text).protocol) ? text : undefined;
  const looks_like_domain = text.includes(".") && !/\s/.test(text);
  return looks_like_domain && URL.canParse(`https://${text}`) ? `https://${text}` : undefined;
}

export function clipboard_target(
  text: string,
  default_engine: string,
  engines: Record<string, { url: string }>,
): string {
  const trimmed = text.trim();
  const url = clipboard_url(trimmed);
  if (url !== undefined) return url;
  const engine = engines[default_engine];
  if (!engine) throw new Error(`The clipboard is not a URL and the default_engine setting names no search engine: "${default_engine}"`);
  return engine_search_url(engine.url, trimmed);
}
