// The one shape every caller produces: keys, command line, native host, palette.

export type Invocation = {
  id: string;
  // Unchecked here. The validator checks them against the command's params.
  args?: Record<string, unknown>;
  // Numeric prefix. The router applies the command's `count` rule.
  count?: number;
};

// One invocation, or an array that runs in order.
export type KeyBinding = Invocation | Invocation[];
