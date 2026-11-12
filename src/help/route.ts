// The help page is one document with hash routes: `#/commands`, `#/styling`, and so on.

export const HELP_PAGE_FILE = "home.html";

export const PAGES = [
  { id: "home", title: "Home", hash: "#/" },
  { id: "settings", title: "Settings", hash: "#/settings" },
  { id: "quick-start", title: "Quick Start", hash: "#/quick-start" },
  { id: "commands", title: "Commands", hash: "#/commands" },
  { id: "search-engines", title: "Search Engines", hash: "#/search-engines" },
  { id: "styling", title: "Styling", hash: "#/styling" },
  { id: "site-rules", title: "Site Rules", hash: "#/site-rules" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

export type Route = { page: PageId; engine?: string; command?: string; section?: string; address?: string; advanced?: true };

// `engine.show <name>` opens `#engine=<name>`, which stays valid and lands on the Search Engines page.
// `#section=<page>/<slug>` lands on that page at that section, the same way, for every page with sections.
// `#command=<id>` lands on the Commands page at that command's card.
// A trailing `?advanced` on any of them also shows the Commands page cards flagged `advanced`.
// `#/site-rules?address=<address>` shows the Site Rules page for that address, which `help site_rules` fills in from the invoking tab. Without an address that page tells the reader where to run it.
// An unknown hash shows Home.
export function parse_route(hash: string): Route {
  const advanced = hash.endsWith(ADVANCED_SUFFIX);
  const route = parse_route_without_flag(advanced ? hash.slice(0, -ADVANCED_SUFFIX.length) : hash);
  return advanced ? { ...route, advanced: true } : route;
}

export const ADVANCED_SUFFIX = "?advanced";

const SITE_RULES_ADDRESS = /^#\/site-rules\?address=(.+)$/;

// Read before the whole hash is decoded, because an address holds `?`, `#` and `%` that must stay inside the one value.
function site_rules_route(hash: string): Route | undefined {
  const encoded = SITE_RULES_ADDRESS.exec(hash)?.[1];
  if (encoded === undefined) return undefined;
  try {
    return { page: "site-rules", address: decodeURIComponent(encoded) };
  } catch {
    return { page: "site-rules" };
  }
}

function parse_route_without_flag(hash: string): Route {
  const site_rules = site_rules_route(hash);
  if (site_rules) return site_rules;
  let text = hash;
  try {
    text = decodeURIComponent(hash);
  } catch {
    // A malformed escape leaves the raw hash, which matches no page and shows Home.
  }
  const engine = /^#engine=(.+)$/.exec(text)?.[1];
  if (engine !== undefined) return { page: "search-engines", engine };
  const section = /^#section=([^/]+)\/(.+)$/.exec(text);
  const section_page = PAGES.find((candidate) => candidate.id === section?.[1]);
  if (section_page !== undefined) return { page: section_page.id, section: section![2]! };
  const command = /^#command=(.+)$/.exec(text)?.[1];
  if (command !== undefined) return { page: "commands", command };
  const page = PAGES.find((candidate) => candidate.hash === text);
  return { page: page?.id ?? "home" };
}

// The URL that opens help at a command's card. The id is encoded, so a snippet id with odd characters stays one value.
export const command_help_url = (base: string, command_id: string): string => `${base}#command=${encodeURIComponent(command_id)}`;

// The URL of the Site Rules page for one address, encoded so any address stays one value.
export const site_rules_help_url = (base: string, address: string): string => `${base}#/site-rules?address=${encodeURIComponent(address)}`;
