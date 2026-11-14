import type { BundleName } from "./bundles.ts";
import type { ContextSource } from "./command.ts";

// The one shape every caller produces: keys, command line, native host, palette.

export type Invocation = {
  id: string;
  // Unchecked here. The validator checks them against the command's params.
  args?: Record<string, unknown>;
  // Numeric prefix. The router applies the command's `count` rule.
  count?: number;
  // Set by the router and the key compiler for a command whose code sits in a lazy bundle. The content script runs the command through that bundle.
  bundle?: BundleName;
};

// Only a key binding carries a prompt: other callers type the whole command line themselves.
export type Prompt = {
  // The param the user types. It must name a param of the command.
  param: string;
  // Text the prompt starts with in that param.
  prefill?: ContextSource;
};

// An invocation as a key binding writes it.
// `label` replaces the which-key label derived from the command. On a binding of several invocations only the first one's label counts.
// `intent` replaces the hover text of the which-key row, which is the command intent otherwise. It follows `label`: on a binding of several invocations only the first one counts, and modifier variants do not inherit it.
// `variant_label` is the label of the variants a modifier derives from this key, which name the target and leave the action to the modifier's group title. It falls back to `label`.
// `when_focus` is a CSS selector. It makes a site row bind run only while nothing has focus or the focused element sits on or inside an element it matches. Otherwise the key runs the binding the bind replaced. Like `label`, only the first invocation's counts.
// `site_search` is set by the key compiler for a `site_keys` key: its letter, and the engines to pick from by page, in order. `args.engine` holds the first one, so the compile-time check has an engine to check.
export type BoundInvocation = Invocation & { prompt?: Prompt; label?: string; intent?: string; variant_label?: string; when_focus?: string; site_search?: { letter: string; engines: string[] } };

// One invocation, or an array that runs in order.
export type KeyBinding = BoundInvocation | BoundInvocation[];
