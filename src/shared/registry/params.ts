// Small readers over a command's params, shared by the define checks, the
// validator, the parser and the usage line.

import type { CommandDef, ContextSource, DynamicValues, ParamDef, ParamValue } from "../command.ts";

export const CONTEXT_SOURCE_NAMES = ["current_url", "selection", "clipboard"] as const;

export function is_context_source(value: unknown): value is ContextSource {
  if (typeof value !== "object" || value === null) return false;
  const from = (value as { from?: unknown }).from;
  return CONTEXT_SOURCE_NAMES.some((name) => name === from);
}

export function is_dynamic_values(values: ParamDef["values"]): values is DynamicValues {
  return values !== undefined && !Array.isArray(values);
}

export function static_values(param: ParamDef): readonly string[] | undefined {
  return Array.isArray(param.values) ? (param.values as readonly string[]) : undefined;
}

export function is_flag_param(param: ParamDef): boolean {
  return param.flag !== undefined;
}

export function is_switch(param: ParamDef): boolean {
  return param.flag !== undefined && param.type === "bool";
}

// Positional params are the ones without `flag`, in definition order.
export function positional_params(command: Pick<CommandDef, "params">): ParamDef[] {
  return (command.params ?? []).filter((param) => !is_flag_param(param));
}

export function find_param(command: Pick<CommandDef, "params">, name: string): ParamDef | undefined {
  return (command.params ?? []).find((param) => param.name === name);
}

// How a message names a param: the long flag when it has one.
export function param_label(param: ParamDef): string {
  return is_flag_param(param) ? `--${param.name}` : param.name;
}

export function join_alternatives(values: readonly ParamValue[]): string {
  const words = values.map(String);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}
