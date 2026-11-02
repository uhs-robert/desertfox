// User snippets. Each one is a registry command that runs the user's code in the top frame of the
// active tab, only when the tab URL matches the snippet's list. The background checks `matches`,
// never the page.

import type { CheckedArgs, CommandContext, CommandDef } from "../shared/command.ts";
import type { SnippetEntry } from "../shared/config.ts";
import { matches_pattern } from "../shared/match_pattern.ts";
import { parse_command_line, type Registry } from "../shared/registry/index.ts";
import { create_router, type RouterDeps } from "./router.ts";

export const MAX_SNIPPET_DEPTH = 5;

export type SnippetDeps = {
  tab_url: (tab_id: number) => Promise<string | undefined>;
  // Runs code in frame 0 and resolves to what the code returned.
  execute_in_top_frame: (tab_id: number, code: string) => Promise<unknown>;
};

// Sent by `oasisfox.run` inside a snippet. `depth` is the level of the calling snippet.
export type SnippetCall = { type: "snippet_run"; command_text: string; depth: number };

export type SnippetAnswer = { ok: true } | { ok: false; message: string };

export type Snippets = {
  // Defines the commands. Returns a warning for each one the registry rejects.
  register: (entries: readonly SnippetEntry[]) => string[];
  handle_call: (call: SnippetCall, sender_tab_id: number | undefined) => Promise<SnippetAnswer>;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The code runs inside an async function, so top-level `await` and `return` work. The wrapper
// answers null on success and the error text otherwise, because a rejection from `executeScript`
// would lose the difference between a syntax error and a thrown one.
// The URL guard covers a navigation between the match check and the injection.
// The body's function takes `browser`, `chrome` and the wrapper's own names as parameters that
// stay undefined, so the body does not see them. This guards against accidents, it is not a sandbox:
// `globalThis.browser` is still there.
export function wrap_snippet_code(code: string, args: CheckedArgs, depth: number, checked_url: string): string {
  return `(async (send, expected_url) => {
if (location.href !== expected_url) return "the page changed before the snippet ran";
return await (async (args, oasisfox, browser, chrome, send, expected_url) => {
try {
${code}
  return null;
} catch (error) {
  try { return String((error && error.message) || error); } catch { return "unreadable error"; }
}
})(${JSON.stringify(args)}, { run: async (command_text) => {
  const answer = await send({ type: "snippet_run", command_text, depth: ${depth} });
  if (!answer || !answer.ok) throw new Error(answer ? answer.message : "OasisFox did not answer");
} });
})(browser.runtime.sendMessage.bind(browser.runtime), ${JSON.stringify(checked_url)})`;
}

export function create_snippets(registry: Registry, deps: SnippetDeps, router_deps: RouterDeps): Snippets {
  const entries_by_id = new Map<string, SnippetEntry>();

  async function run_snippet(entry: SnippetEntry, context: CommandContext, args: CheckedArgs, depth: number): Promise<void> {
    if (context.tab_id === undefined) throw new Error(`${entry.id}: needs a tab`);
    const url = await deps.tab_url(context.tab_id);
    if (url === undefined || !entry.matches.some((pattern) => matches_pattern(pattern, url))) {
      throw new Error(`${entry.id}: does not run on this page`);
    }
    let answer: unknown;
    try {
      answer = await deps.execute_in_top_frame(context.tab_id, wrap_snippet_code(entry.code, args, depth, url));
    } catch (error) {
      throw new Error(`${entry.id}: ${message_of(error)}`);
    }
    if (typeof answer === "string") throw new Error(`${entry.id}: ${answer}`);
  }

  // A snippet that runs from a snippet knows its level, so the limit needs no state outside the call.
  function command_at_depth(id: string, depth: number): CommandDef | undefined {
    const command = registry.get(id);
    const entry = entries_by_id.get(id);
    if (!command || !entry) return command;
    return { ...command, run: (context, args) => run_snippet(entry, context, args, depth) };
  }

  function register(entries: readonly SnippetEntry[]): string[] {
    const warnings: string[] = [];
    const built_in_groups = new Set(registry.list().map((command) => command.id.split(".")[0]));
    for (const entry of entries) {
      if (built_in_groups.has(entry.id.split(".")[0])) {
        warnings.push(`snippet ${entry.id} skipped: the group "${entry.id.split(".")[0]}" is used by OasisFox commands`);
        continue;
      }
      try {
        registry.define(entry.id, {
          ...(entry.name === undefined ? {} : { name: entry.name }),
          ...(entry.aliases === undefined ? {} : { aliases: entry.aliases }),
          label: entry.label,
          intent: entry.intent,
          ...(entry.params === undefined ? {} : { params: entry.params }),
          runs_in: "background",
          run: (context, args) => run_snippet(entry, context, args, 1),
        });
        entries_by_id.set(entry.id, entry);
      } catch (error) {
        warnings.push(`snippet ${entry.id} skipped: ${message_of(error)}`);
      }
    }
    return warnings;
  }

  async function handle_call(call: SnippetCall, sender_tab_id: number | undefined): Promise<SnippetAnswer> {
    if (!Number.isInteger(call.depth) || call.depth < 1 || typeof call.command_text !== "string") {
      return { ok: false, message: "oasisfox.run needs a command text" };
    }
    if (call.depth >= MAX_SNIPPET_DEPTH) {
      return { ok: false, message: `snippets can call snippets ${MAX_SNIPPET_DEPTH} levels deep at most` };
    }
    const parsed = parse_command_line(registry, call.command_text, await router_deps.get_enum_sources());
    if (parsed.kind === "error") return { ok: false, message: parsed.error };
    if (parsed.kind === "help") return { ok: false, message: "oasisfox.run does not show help" };

    // The caller gets the failure as a rejection, so no toast here: the snippet at the top shows one.
    const nested_router = create_router({
      ...router_deps,
      get_command: (id) => command_at_depth(id, call.depth + 1),
      show_refusal: async () => undefined,
    });
    const response = await nested_router.run({
      invocations: [parsed.invocation],
      mode: "normal",
      ...(sender_tab_id === undefined ? {} : { sender_tab_id }),
    });
    return response.ok ? { ok: true } : { ok: false, message: response.refusal.message };
  }

  return { register, handle_call };
}
