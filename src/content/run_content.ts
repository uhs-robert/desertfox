import type { Invocation } from "../shared/index.ts";
import { read_context_source } from "./context.ts";
import { content_handlers } from "./handler_map.ts";
import { args_for_count } from "./invocation_args.ts";

// Runs one invocation here. Throws an Error whose message the caller shows as a toast.
export function run_content_invocation(invocation: Invocation): void {
  const handler = content_handlers[invocation.id];
  if (!handler) throw new Error(`${invocation.id} cannot run in the page`);
  const filled: Record<string, unknown> = { ...invocation.args };
  for (const [param, source] of Object.entries(handler.fill_from_page ?? {})) {
    filled[param] ??= read_context_source(source);
  }
  for (const args of args_for_count(filled, invocation.count, handler.count)) handler.run(args);
}
