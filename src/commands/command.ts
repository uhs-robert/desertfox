import type { CommandContext } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { define } from "../shared/registry/index.ts";

export type RepeatDeps = {
  // The stored request for the window the key came from, or undefined when nothing is stored.
  load: (ctx: CommandContext) => Promise<BoundInvocation[] | undefined>;
  // Runs the invocations through the router. The router shows its own refusal.
  run_batch: (invocations: BoundInvocation[], ctx: CommandContext) => Promise<unknown>;
};

// The router does not exist when the commands load, so `main.ts` wires the deps after it builds the router.
let wired: RepeatDeps | undefined;
export const wire_repeat = (deps: RepeatDeps) => void (wired = deps);

export function make_repeat_handler(get_deps: () => RepeatDeps | undefined) {
  return async (ctx: CommandContext, args: { count?: unknown }) => {
    const deps = get_deps();
    const stored = deps && (await deps.load(ctx));
    if (!deps || !stored?.length) throw new Error("Nothing to repeat");
    const count = typeof args.count === "number" && args.count > 0 ? args.count : undefined;
    await deps.run_batch(count === undefined ? stored : stored.map((invocation) => ({ ...invocation, count })), ctx);
  };
}

const handler = make_repeat_handler(() => wired);

define("command.repeat", {
  name: "repeat",
  label: "Repeat",
  intent: "Run the last repeatable command again. A count replaces the one it had, and 0 keeps it. A hint pick starts a new pick of the same kind.",
  params: [{ name: "count", type: "int", default: 0, description: "Replace the saved count with this one. 0 keeps it." }],
  count: { param: "count" },
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handler(ctx, args),
});
