// One check for "can this page fill what the thing needs?", shared by engines, snippets and which-key.
// A requirement is a list of slot expressions such as "repo" or "host|title". All must be fillable.

import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { MergedConfig, SearchEngine } from "../shared/config.ts";
import { parse_http_url, slot_of } from "../shared/engines/index.ts";
import { engine_url, search_engine_name } from "../commands/url_build.ts";
import type { PageInfo } from "../shared/engines/index.ts";
import type { CheckedArgs } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";

export function is_available(requirement: readonly string[], page: PageInfo | undefined): boolean {
  return requirement.every((expression) =>
    expression.split("|").some((name) => {
      const slot = slot_of(name);
      return slot?.kind === "page" && page !== undefined && slot.read(page) !== undefined;
    }),
  );
}

// An engine with a fallback always runs, so it asks nothing of the page.
export const engine_requirement = (engine: SearchEngine): string[] => (engine.fallback === undefined ? (engine.slots ?? []) : []);

// For command line completion, which lists only the engines the page can run.
export function available_engine_names(engines: Record<string, SearchEngine>, page: PageInfo | undefined): string[] {
  return Object.keys(engines).filter((name) => is_available(engine_requirement(engines[name]!), page));
}

// The engine a search runs: the one it names, else the default_engine setting.
const search_engine_name_of = (config: Pick<MergedConfig, "settings">, named: unknown): string =>
  search_engine_name(named, config.settings.default_engine ?? DEFAULT_SETTINGS.default_engine);

// Whether the engine belongs to the page's site. An engine with no `hosts` belongs to every site.
const on_site = (engine: SearchEngine, page: PageInfo | undefined): boolean => {
  const host = page && parse_http_url(page.url)?.hostname;
  return engine.hosts === undefined || (host !== undefined && engine.hosts.includes(host));
};

// The engine a `site_keys` key runs on this page: the first candidate on the page's site whose slots the page fills.
export function site_engine_for(engines: Record<string, SearchEngine>, candidates: readonly string[], page: PageInfo | undefined): string | undefined {
  return candidates.find((name) => {
    const engine = engines[name];
    return engine !== undefined && on_site(engine, page) && is_available(engine_requirement(engine), page);
  });
}

// Settles the engine of each `site_keys` invocation for the page. A key typed on a page that fits none of its engines is not run: the result names its letter, for the refusal.
export function with_site_engines(invocations: BoundInvocation[], engines: Record<string, SearchEngine>, page: PageInfo | undefined): { invocations: BoundInvocation[] } | { unfit_letter: string } {
  const settled: BoundInvocation[] = [];
  for (const invocation of invocations) {
    const { site_search, ...plain } = invocation;
    if (site_search === undefined) {
      settled.push(invocation);
      continue;
    }
    const engine = site_engine_for(engines, site_search.engines, page);
    if (engine === undefined) return { unfit_letter: site_search.letter };
    settled.push({ ...plain, args: { ...plain.args, engine } });
  }
  return { invocations: settled };
}

// What one invocation asks of the page: the slots of the engine a search names, the `requires` of a snippet.
// A `site_keys` key asks nothing here: `site_engine_for` decides it.
export function requirement_lookup(config: Pick<MergedConfig, "search_engines" | "snippets" | "settings">): (invocation: BoundInvocation) => string[] {
  const snippets = new Map(config.snippets.map((snippet) => [snippet.id, snippet]));
  return (invocation) => {
    if (invocation.site_search) return [];
    if (invocation.id === "open.search") {
      const engine = config.search_engines[search_engine_name_of(config, invocation.args?.engine)];
      return engine ? engine_requirement(engine) : [];
    }
    return snippets.get(invocation.id)?.requires ?? [];
  };
}

// For the router: only a search runs with an empty query, and only when its engine, or the fallback that runs in its
// place, fills the URL from this page without one.
export function runs_with_empty(config: Pick<MergedConfig, "search_engines" | "settings">, command_id: string, args: CheckedArgs, param: string, page: PageInfo | undefined): boolean {
  if (command_id !== "open.search" || param !== "query") return false;
  // No query at all rather than an empty one, because a lone {query} takes an empty value and would pass.
  try {
    engine_url(config.search_engines, search_engine_name_of(config, args.engine), page ? { page } : {});
    return true;
  } catch {
    return false;
  }
}
