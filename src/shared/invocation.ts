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
// `when_present` is a CSS selector too. The bind runs only while the page shows an element it matches, and falls through like `when_focus` otherwise. A bind with both runs only while both hold.
// `otherwise` is `"page"` to hand the real key to the page when every guard fails, in place of the binding the bind replaced. Like a guard, only the first invocation's counts.
// `fallback` is for the default keymap alone: the binding the key runs when a guard of this one fails. It ends the chain, so it carries no guard of its own.
// `site_search` is set by the key compiler for a `site_keys` key: its letter, and the engines to pick from by page, in order. `args.engine` holds the first one, so the compile-time check has an engine to check.
export type BoundInvocation = Invocation & { prompt?: Prompt; label?: string; intent?: string; variant_label?: string; when_focus?: string; when_present?: string; otherwise?: "page"; fallback?: BoundInvocation; site_search?: { letter: string; engines: string[] } };

// One invocation, or an array that runs in order.
export type KeyBinding = BoundInvocation | BoundInvocation[];

// A binding written as a `{ run, label, intent, when_focus, when_present }` table.
export const is_run_table = (value: unknown): value is Record<string, unknown> & { run: unknown } => typeof value === "object" && value !== null && !Array.isArray(value) && "run" in value;

// A site row bind that lists guarded choices: the `{ run, when_present, when_focus }` tables a file writes, or the step lists the build stores for them. A list of steps holds neither.
export const is_choice_list = (binding: unknown): binding is readonly unknown[] => Array.isArray(binding) && binding.length > 0 && binding.every((choice) => Array.isArray(choice) || is_run_table(choice));
