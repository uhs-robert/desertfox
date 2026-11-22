import type { CountBehavior, Invocation, LeafStep, Outcome } from "../shared/index.ts";
import { bundles } from "./bundles.ts";
import { settle } from "./bundle_host.ts";
import { content_handlers } from "./handler_map.ts";
import type { ContentHandler } from "./handlers/types.ts";
import { scroll_by } from "./handlers/scroll.ts";
import { args_for_count } from "./invocation_args.ts";

// A command whose code sits in a bundle runs through the bundle host, which loads the bundle on the first run. A bundle that registers no handler yet refuses with `needs <bundle name>`.
const lazy_handler = ({ id, bundle }: Invocation): ContentHandler => {
  if (!bundle) throw new Error(`${id} cannot run in the page`);
  // `id as string` lifts the page.item narrowing: the registry validated these args, so they need no map check.
  return { run: (args) => (id === "page.item" && !args.selector ? scroll_if_refused(args, bundles.run_command_(id as string, bundle, args, `needs ${bundle}`)) : bundles.run_command_(id, bundle, args, `needs ${bundle}`)) };
};

// The item finder binds j, k, h, l, gg and G on every page, so a page where the item bundle cannot load or run (one still loading, a privileged page) or that shows no list still scrolls. The ends take the plain scroll to the top or bottom. A bound row names its selector and keeps the refusal.
const scroll_if_refused = (args: Record<string, unknown>, run: Promise<Outcome>): Promise<Outcome> =>
  run.then((outcome) => {
    const [dx, dy] = { down: [0, 50], up: [0, -50], left: [-50, 0], right: [50, 0] }[args.direction as string] ?? [];
    if (outcome.ok) return outcome;
    if (args.direction === "first" || args.direction === "last") {
      void content_handlers["scroll.to"]!.run({ percent: args.direction === "last" ? 100 : 0, axis: "y" }, false);
      return { ok: true };
    }
    if (dx === undefined) return outcome;
    scroll_by(dx * Number(args.times ?? 1), dy! * Number(args.times ?? 1));
    return { ok: true };
  });

// Runs one invocation here and answers how it ended. Never rejects and shows nothing: the caller shows a failure once.
// Its args are already checked, with defaults filled in, by the background compiler.
// A count runs the handler in turn and stops at the first step that is not done.
export const run_content_invocation = (invocation: Invocation, count_rule: CountBehavior, repeat = false): Promise<Outcome> =>
  settle(async () => {
    const handler = content_handlers[invocation.id] ?? lazy_handler(invocation);
    for (const args of args_for_count(invocation.args ?? {}, invocation.count, count_rule)) {
      // A throw reaches the outer settle, which answers it as failed.
      const outcome = (await handler.run(args, repeat)) as Outcome | undefined;
      if (outcome && (!outcome.ok || outcome.cancelled)) return outcome;
    }
  });

// Runs the invocations one after another and answers with the first outcome that is not done, or done when all are. Each runs under the count rule `rule_of` gives it.
async function run_all(invocations: Invocation[], rule_of: (index: number) => CountBehavior, repeat?: boolean): Promise<Outcome> {
  for (const [index, invocation] of invocations.entries()) {
    const outcome = await run_content_invocation(invocation, rule_of(index), repeat);
    if (!outcome.ok || outcome.cancelled) return outcome;
  }
  return { ok: true };
}

export const run_in_order = (invocations: Invocation[], repeat?: boolean): Promise<Outcome> => run_all(invocations, () => "ignore", repeat);

// A leaf's steps with the typed count on each. The router applies the count rule of a step it runs.
export const counted_invocations = (steps: readonly LeafStep[], count: number | undefined): Invocation[] =>
  steps.map(({ invocation, bundle, count_rule }) => {
    const sent = bundle ? { ...invocation, bundle } : invocation;
    return count === undefined || count_rule === "ignore" ? sent : { ...sent, count };
  });

// Runs a leaf of content steps here. A step starts after the one before it has finished, and the first runs in the caller's turn.
// Stops at the first step that is not done, so a wait the user leaves or a failure ends the leaf.
export const run_content_steps = (steps: readonly LeafStep[], count: number | undefined, repeat = false): Promise<Outcome> =>
  run_all(counted_invocations(steps, count), (index) => steps[index]!.count_rule, repeat);
