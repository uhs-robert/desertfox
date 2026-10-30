// Applies a command's count rule to an invocation. The content bundle has no
// registry, so each handler carries its own rule.

import type { CheckedArgs, CountBehavior } from "../shared/index.ts";

// One entry per run: "repeat" yields `count` copies of the args.
export function args_for_count(args: CheckedArgs, count: number | undefined, rule: CountBehavior): CheckedArgs[] {
  if (count === undefined || rule === "ignore") return [args];
  if (rule === "repeat") return Array.from({ length: count }, () => args);
  return [{ ...args, [rule.param]: count }];
}
