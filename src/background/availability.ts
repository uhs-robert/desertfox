// One check for "can this page fill what the thing needs?", shared by engines, snippets and which-key.
// A requirement is a list of slot expressions such as "repo" or "host|title". All must be fillable.

import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { MergedConfig, SearchEngine } from "../shared/config.ts";
import { slot_of } from "../shared/engines/index.ts";
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

// What one invocation asks of the page: the slots of the engine a search names, the `requires` of a snippet.
export function requirement_lookup(config: Pick<MergedConfig, "search_engines" | "snippets" | "settings">): (invocation: BoundInvocation) => string[] {
  const snippets = new Map(config.snippets.map((snippet) => [snippet.id, snippet]));
  return (invocation) => {
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
