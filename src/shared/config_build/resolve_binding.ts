// Turns one binding as a config file writes it into invocations. The keymap and the site rows share it, and so does the compile, which resolves a text bind that a browser edit set.

import { intent_problem, label_problem } from "../keys/index.ts";
import type { BoundInvocation } from "../invocation.ts";
import type { EnumSources } from "../registry/check_args.ts";
import { parse_binding } from "../registry/parse_binding.ts";
import type { Registry } from "../registry/index.ts";

type Step = string | BoundInvocation;

export function is_labeled_binding(entry: unknown): entry is { run: Step | readonly Step[]; label?: string; intent?: string } {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) && "run" in entry;
}

// Each problem goes to `problems` with `where` in front, and the entry then resolves to undefined.
export function make_entry_resolver(registry: Registry, sources: EnumSources, problems: string[]) {
  const resolve_text = (text: string, where: string): BoundInvocation | undefined => {
    const result = parse_binding(registry, text, sources);
    if (result.kind === "error") problems.push(`${where}: ${result.error}`);
    else return result.binding;
  };
  // A step that is not text is an invocation the file already holds, as a saved edit exports it.
  const resolve_step = (step: Step, where: string): BoundInvocation | undefined => (typeof step === "string" ? resolve_text(step, where) : step);
  const resolve_run = (run: Step | readonly Step[], where: string): BoundInvocation | BoundInvocation[] | undefined => {
    if (!Array.isArray(run)) return resolve_step(run as Step, where);
    const parsed = run.map((step) => resolve_step(step, where));
    return parsed.every((binding) => binding !== undefined) ? parsed : undefined;
  };
  // The label and the intent sit on the first invocation, as the compiler reads them there.
  return (entry: unknown, where: string): BoundInvocation | BoundInvocation[] | undefined => {
    if (!is_labeled_binding(entry)) return resolve_run(entry as Step | readonly Step[], where);
    const binding = resolve_run(entry.run, where);
    if (!binding) return undefined;
    const problem = entry.label === undefined ? null : label_problem(entry.label);
    if (problem) problems.push(`${where}: ${problem}`);
    const intent_error = entry.intent === undefined ? null : intent_problem(entry.intent);
    if (intent_error) problems.push(`${where}: ${intent_error}`);
    if (!problem && !intent_error) {
      if (entry.label !== undefined) [binding].flat()[0]!.label = entry.label;
      if (entry.intent !== undefined) [binding].flat()[0]!.intent = entry.intent;
    }
    return binding;
  };
}
