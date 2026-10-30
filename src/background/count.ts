import type { CommandDef } from "../shared/command.ts";
import type { Invocation } from "../shared/invocation.ts";

export type CountedRun = { args: Record<string, unknown> | undefined; times: number };

// Applies the command's `count` rule to a numeric prefix.
export function apply_count(command: Pick<CommandDef, "count">, invocation: Invocation): CountedRun {
  const { args, count } = invocation;
  if (count === undefined) return { args, times: 1 };
  const rule = command.count ?? "ignore";
  if (rule === "ignore") return { args, times: 1 };
  if (rule === "repeat") return { args, times: Math.max(1, count) };
  return { args: { ...args, [rule.param]: count }, times: 1 };
}
