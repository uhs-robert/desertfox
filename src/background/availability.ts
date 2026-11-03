// One check for "can this page fill what the thing needs?", shared by engines, snippets and which-key.
// A requirement is a list of slot expressions such as "repo" or "host|title". All must be fillable.

import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { MergedConfig, SearchEngine } from "../shared/config.ts";
import { slot_of } from "../shared/engines/index.ts";
import type { PageInfo } from "../shared/engines/index.ts";
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

// What one invocation asks of the page: the slots of the engine a search names, the `requires` of a snippet.
export function requirement_lookup(config: Pick<MergedConfig, "search_engines" | "snippets" | "settings">): (invocation: BoundInvocation) => string[] {
  const snippets = new Map(config.snippets.map((snippet) => [snippet.id, snippet]));
  return (invocation) => {
    if (invocation.id === "open.search") {
      const named = invocation.args?.engine;
      const name = typeof named === "string" && named !== "" ? named : (config.settings.default_engine ?? DEFAULT_SETTINGS.default_engine);
      const engine = config.search_engines[name];
      return engine ? engine_requirement(engine) : [];
    }
    return snippets.get(invocation.id)?.requires ?? [];
  };
}
