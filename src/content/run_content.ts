import type { CountBehavior, Invocation, Outcome } from "../shared/index.ts";
import { settle } from "./bundle_host.ts";
import { read_context_source } from "./context.ts";
import { content_handlers } from "./handler_map.ts";
import { args_for_count } from "./invocation_args.ts";

// Runs one invocation here and answers how it ended. Never rejects and shows nothing: the caller shows a failure once.
// Its args are already checked, with defaults filled in, by the background compiler.
// A count runs the handler in turn and stops at the first step that is not done.
export const run_content_invocation = (invocation: Invocation, count_rule: CountBehavior): Promise<Outcome> =>
  settle(async () => {
    const handler = content_handlers[invocation.id];
    if (!handler) throw new Error(`${invocation.id} cannot run in the page`);
    const filled: Record<string, unknown> = { ...invocation.args };
    for (const [param, source] of Object.entries(handler.fill_from_page ?? {})) {
      filled[param] ??= read_context_source(source);
    }
    for (const args of args_for_count(filled, invocation.count, count_rule)) {
      const outcome = await settle(() => handler.run(args));
      if (!outcome.ok || outcome.cancelled) return outcome;
    }
  });

// Runs the invocations one after another and answers with the first outcome that is not done, or done when all are.
export async function run_in_order(invocations: Invocation[]): Promise<Outcome> {
  for (const invocation of invocations) {
    const outcome = await run_content_invocation(invocation, "ignore");
    if (!outcome.ok || outcome.cancelled) return outcome;
  }
  return { ok: true };
}
