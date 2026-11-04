// The help page is one document with hash routes: `#/commands`, `#/styling`, and so on.

export const HELP_PAGE_FILE = "help.html";

export const PAGES = [
  { id: "home", title: "Home", hash: "#/" },
  { id: "quick-start", title: "Quick Start", hash: "#/quick-start" },
  { id: "search-engines", title: "Search Engines", hash: "#/search-engines" },
  { id: "commands", title: "Commands", hash: "#/commands" },
  { id: "styling", title: "Styling", hash: "#/styling" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

export type Route = { page: PageId; engine?: string };

// `engine.show <name>` opens `#engine=<name>`, which stays valid and lands on the Search Engines page.
// An unknown hash shows Home.
export function parse_route(hash: string): Route {
  let text = hash;
  try {
    text = decodeURIComponent(hash);
  } catch {
    // A malformed escape leaves the raw hash, which matches no page and shows Home.
  }
  const engine = /^#engine=(.+)$/.exec(text)?.[1];
  if (engine !== undefined) return { page: "search-engines", engine };
  const page = PAGES.find((candidate) => candidate.hash === text);
  return { page: page?.id ?? "home" };
}
