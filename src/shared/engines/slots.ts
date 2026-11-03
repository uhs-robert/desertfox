// The slots a URL template can use. An input slot comes from the person (the query). A page slot is read from the
// tab the engine runs on, and reads nothing when the page has no answer.

export type PageInfo = { url: string; title?: string };

export type InputSlot = { kind: "input"; message: string };
export type PageSlot = { kind: "page"; message: string; read: (page: PageInfo) => string | undefined };
export type SlotDef = InputSlot | PageSlot;

const GITHUB_HOSTS = ["github.com", "www.github.com"];
const REDDIT_HOSTS = ["reddit.com", "www.reddit.com", "old.reddit.com"];

export function parse_http_url(page_url: string): URL | undefined {
  try {
    const url = new URL(page_url);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export function path_segments(url: URL): string[] {
  return url.pathname.split("/").filter((segment) => segment !== "");
}

export function github_repo_of(page_url: string): { owner: string; repo: string } | undefined {
  const url = parse_http_url(page_url);
  if (!url || !GITHUB_HOSTS.includes(url.hostname)) return undefined;
  const [owner, repo] = path_segments(url);
  return owner && repo ? { owner, repo } : undefined;
}

export function subreddit_of(page_url: string): string | undefined {
  const url = parse_http_url(page_url);
  if (!url || !REDDIT_HOSTS.includes(url.hostname)) return undefined;
  const [prefix, name] = path_segments(url);
  return prefix === "r" ? name : undefined;
}

export const SLOTS: Record<string, SlotDef> = {
  query: { kind: "input", message: "This engine needs a query" },
  url: { kind: "page", message: "This address is not a web page", read: (page) => (parse_http_url(page.url) ? page.url : undefined) },
  host: { kind: "page", message: "This address has no site", read: (page) => parse_http_url(page.url)?.hostname },
  title: { kind: "page", message: "This page has no title", read: (page) => (page.title ? page.title : undefined) },
  repo: {
    kind: "page",
    message: "This page is not in a GitHub repository",
    read: (page) => {
      const found = github_repo_of(page.url);
      return found ? `${found.owner}/${found.repo}` : undefined;
    },
  },
  subreddit: { kind: "page", message: "This page is not in a subreddit", read: (page) => subreddit_of(page.url) },
};

export const SLOT_NAMES = Object.keys(SLOTS);

export const is_slot_name = (name: string): boolean => Object.hasOwn(SLOTS, name);

export const slot_of = (name: string): SlotDef | undefined => (is_slot_name(name) ? SLOTS[name] : undefined);
