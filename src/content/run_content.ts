import type { CountBehavior, Invocation, LeafStep, Outcome } from "../shared/index.ts";
import { BUNDLE_LABELS } from "../shared/bundles.ts";
import { bundles } from "./bundles.ts";
import { settle } from "./bundle_host.ts";
import { read_context_source } from "./context.ts";
import { content_handlers } from "./handler_map.ts";
import type { ContentHandler } from "./handlers/types.ts";
import { args_for_count } from "./invocation_args.ts";

// A command whose code sits in a bundle runs through the bundle host, which loads the bundle on the first run. A bundle that registers no handler yet refuses with `needs <label>`.
const lazy_handler = ({ id, bundle }: Invocation): ContentHandler => {
  if (!bundle) throw new Error(`${id} cannot run in the page`);
  return { run: (args) => bundles.run_command_(id, bundle, args, `needs ${BUNDLE_LABELS[bundle]}`) };
};

// Runs one invocation here and answers how it ended. Never rejects and shows nothing: the caller shows a failure once.
// Its args are already checked, with defaults filled in, by the background compiler.
// A count runs the handler in turn and stops at the first step that is not done.
export const run_content_invocation = (invocation: Invocation, count_rule: CountBehavior, repeat = false): Promise<Outcome> =>
  settle(async () => {
    const handler = content_handlers[invocation.id] ?? lazy_handler(invocation);
    const filled: Record<string, unknown> = { ...invocation.args };
    for (const [param, source] of Object.entries(handler.fill_from_page_ ?? {})) {
      filled[param] ??= read_context_source(source);
    }
    for (const args of args_for_count(filled, invocation.count, count_rule)) {
      // A throw reaches the outer settle, which answers it as failed.
      const outcome = (await handler.run(args, repeat)) as Outcome | undefined;
      if (outcome && (!outcome.ok || outcome.cancelled)) return outcome;
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

// A leaf's steps with the typed count on each. The router applies the count rule of a step it runs.
export const counted_invocations = (steps: readonly LeafStep[], count: number | undefined): Invocation[] =>
  steps.map(({ invocation, bundle }) => {
    const sent = bundle ? { ...invocation, bundle } : invocation;
    return count === undefined ? sent : { ...sent, count };
  });

// Runs a leaf of content steps here. A step starts after the one before it has finished, and the first runs in the caller's turn.
// Stops at the first step that is not done, so a wait the user leaves or a failure ends the leaf.
export async function run_content_steps(steps: readonly LeafStep[], count: number | undefined, repeat = false): Promise<Outcome> {
  const invocations = counted_invocations(steps, count);
  for (const [index, step] of steps.entries()) {
    const outcome = await run_content_invocation(invocations[index]!, step.count_rule, repeat);
    if (!outcome.ok || outcome.cancelled) return outcome;
  }
  return { ok: true };
}
