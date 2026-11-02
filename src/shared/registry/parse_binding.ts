// Config text to a key binding. Same grammar as the command line, plus a
// leading `:`, which makes the key type the command into the command line and
// wait instead of running it.

import type { ContextSource } from "../command.ts";
import type { BoundInvocation, Prompt } from "../invocation.ts";
import { parse_command_line, type GrammarParam } from "./command_line.ts";
import type { Registry } from "./define.ts";
import { is_context_source } from "./params.ts";

export type BindingResult = { kind: "binding"; binding: BoundInvocation } | { kind: "error"; error: string };

export function parse_binding(registry: Registry, text: string): BindingResult {
  const trimmed = text.trimStart();
  const types_into_command_line = trimmed.startsWith(":");
  const parsed = parse_command_line(registry, types_into_command_line ? trimmed.slice(1) : trimmed);
  if (parsed.kind === "error") return parsed;
  if (parsed.kind === "help") return { kind: "error", error: "-h and --help are for the command line, not a binding" };
  if (!types_into_command_line) return { kind: "binding", binding: parsed.invocation };

  const prompt = prompt_for(registry, parsed.invocation.id, parsed.invocation.args ?? {});
  if (typeof prompt === "string") return { kind: "error", error: prompt };
  const { id, args = {} } = parsed.invocation;
  const binding: BoundInvocation = { id, prompt: prompt.prompt };
  const kept = Object.fromEntries(Object.entries(args).filter(([name]) => name !== prompt.moved_to_prefill));
  if (Object.keys(kept).length > 0) binding.args = kept;
  return { kind: "binding", binding };
}

// The stored form names one param to fill. Pick the one that holds an @source,
// else the main param, else the first param. A source moves out of the args
// into the prefill, which is where the extension reads it.
function prompt_for(
  registry: Registry,
  id: string,
  args: Record<string, unknown>,
): { prompt: Prompt; moved_to_prefill?: string } | string {
  const params = (registry.get(id)?.params ?? []) as readonly GrammarParam[];
  const with_source = params.find((param) => param.type === "string" && is_context_source(args[param.name]));
  const main = params.find((param) => param.main);
  const chosen = with_source ?? main ?? params[0];
  if (!chosen) return `${id} has no param to type, drop the leading ":"`;
  if (chosen === with_source) {
    return { prompt: { param: chosen.name, prefill: args[chosen.name] as ContextSource }, moved_to_prefill: chosen.name };
  }
  return { prompt: { param: chosen.name } };
}
