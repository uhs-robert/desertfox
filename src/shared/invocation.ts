import type { ContextSource } from "./command.ts";

// The one shape every caller produces: keys, command line, native host, palette.

export type Invocation = {
  id: string;
  // Unchecked here. The validator checks them against the command's params.
  args?: Record<string, unknown>;
  // Numeric prefix. The router applies the command's `count` rule.
  count?: number;
};

// Only a key binding carries a prompt: other callers type the whole command line themselves.
export type Prompt = {
  // The param the user types. It must name a param of the command.
  param: string;
  // Text the prompt starts with in that param.
  prefill?: ContextSource;
};

// An invocation as a key binding writes it.
export type BoundInvocation = Invocation & { prompt?: Prompt };

// One invocation, or an array that runs in order.
export type KeyBinding = BoundInvocation | BoundInvocation[];
