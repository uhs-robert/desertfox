// The `item_hover` setting off: a shipped row or the shipped item keys that ask `page.item` for the hover loses the arg. The arg is the whole switch, so the bundle needs no setting.

import type { BoundInvocation } from "../shared/invocation.ts";

const without_hover_arg = (bound: BoundInvocation): BoundInvocation => {
  if (bound.id !== "page.item" || !bound.args?.["hover"]) return bound;
  const { hover: _hover, ...args } = bound.args;
  return { ...bound, args };
};

// Returns a copy: the shipped rows and the shipped item keys are shared between compiles.
export const without_hover = <Shipped>(shipped: Shipped): Shipped => JSON.parse(JSON.stringify(shipped), (_key, value: unknown) => (typeof value === "object" && value && "id" in value ? without_hover_arg(value as BoundInvocation) : value)) as Shipped;
