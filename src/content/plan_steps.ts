// Splits a leaf's steps into runs that keep their order: consecutive background
// steps travel in one message, each content step runs on the spot.

import type { CountBehavior, Invocation, LeafStep } from "../shared/index.ts";

export type Segment =
  | { runs_in: "background"; invocations: Invocation[] }
  | { runs_in: "content"; invocation: Invocation; count_rule: CountBehavior };

export function plan_steps(steps: readonly LeafStep[], count: number | undefined): Segment[] {
  const segments: Segment[] = [];
  for (const step of steps) {
    const invocation = count === undefined ? step.invocation : { ...step.invocation, count };
    const last = segments[segments.length - 1];
    if (step.runs_in === "content") {
      segments.push({ runs_in: "content", invocation, count_rule: step.count_rule });
    } else if (last?.runs_in === "background") {
      last.invocations.push(invocation);
    } else {
      segments.push({ runs_in: "background", invocations: [invocation] });
    }
  }
  return segments;
}
