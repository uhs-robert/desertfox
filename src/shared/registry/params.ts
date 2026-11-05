// Small readers over a command's params, shared by the define checks, the
// validator, the parser and the usage line.

import type { CommandDef, ConditionalDefault, ContextSource, DynamicValues, ParamDef, ParamValue } from "../command.ts";

export const CONTEXT_SOURCE_NAMES = ["current_url", "selection", "clipboard"] as const;

export function is_context_source(value: unknown): value is ContextSource {
  if (typeof value !== "object" || value === null) return false;
  const from = (value as { from?: unknown }).from;
  return CONTEXT_SOURCE_NAMES.some((name) => name === from);
}

export function is_conditional_default(value: unknown): value is ConditionalDefault {
  return typeof value === "object" && value !== null && "value" in value && "when" in value;
}

// What the param declares as its default: "" for an optional param, else its `default` field.
export function declared_default(param: ParamDef): ParamDef["default"] {
  return param.optional ? "" : param.default;
}

// The default that applies once the sibling values are known, or undefined when the param has none and is required. `sibling` reads a sibling's value.
export function applicable_default(param: ParamDef, sibling: (name: string) => unknown): Exclude<ParamDef["default"], ConditionalDefault> | undefined {
  const declared = declared_default(param);
  if (!is_conditional_default(declared)) return declared;
  const [name, allowed] = Object.entries(declared.when)[0] as [string, readonly ParamValue[]];
  return allowed.includes(sibling(name) as ParamValue) ? declared.value : undefined;
}

// `applicable_default` for a param of `command`, reading siblings from `values` (a sibling not in `values` counts by its own plain default).
// Every consumer that asks "does this param have a default" or "is it required" goes through here.
export function default_of(command: Pick<CommandDef, "params">, param: ParamDef, values: Record<string, unknown>): ReturnType<typeof applicable_default> {
  return applicable_default(param, (name) => {
    if (values[name] !== undefined) return values[name];
    const sibling = find_param(command, name);
    const declared = sibling && declared_default(sibling);
    return sibling && !is_conditional_default(declared) ? declared : undefined;
  });
}

// The default value to compare a given value against, whichever form the default has.
export function default_value(param: ParamDef): ParamValue | ContextSource | undefined {
  const declared = declared_default(param);
  return is_conditional_default(declared) ? declared.value : declared;
}

// A default that is a plain value: not a context source, not conditional.
export function literal_default(param: ParamDef): ParamValue | undefined {
  const value = declared_default(param);
  return value === undefined || is_context_source(value) || is_conditional_default(value) ? undefined : value;
}

// A default as the help page prints it.
export function describe_default(param: ParamDef): string {
  const value = declared_default(param);
  if (value === undefined) return "";
  if (is_context_source(value)) return `from ${value.from}`;
  if (!is_conditional_default(value)) return String(value);
  const [name, allowed] = Object.entries(value.when)[0] as [string, readonly ParamValue[]];
  return `${JSON.stringify(value.value)} when ${name} is ${join_alternatives(allowed)}`;
}

export function is_dynamic_values(values: ParamDef["values"]): values is DynamicValues {
  return values !== undefined && !Array.isArray(values);
}

export function static_values(param: ParamDef): readonly string[] | undefined {
  return Array.isArray(param.values) ? (param.values as readonly string[]) : undefined;
}

// The param that the first unmarked word may fill: the search engine (a runtime list), or the one required value of a command that takes nothing else (`mode ignore`).
export function bare_word_param(command: Pick<CommandDef, "params">): ParamDef | undefined {
  const params = command.params ?? [];
  const from_list = params.find((param) => param.type === "enum" && is_dynamic_values(param.values));
  if (from_list) return from_list;
  const [only] = params;
  const required = only !== undefined && declared_default(only) === undefined && only.when === undefined;
  return params.length === 1 && required && only.type === "enum" && static_values(only) ? only : undefined;
}

// The param typed last and bare: the main text, else the one number, else the one required value.
export function subject_param(command: Pick<CommandDef, "params">): ParamDef | undefined {
  const params = command.params ?? [];
  const main = params.find((param) => param.main);
  if (main) return main;
  const numbers = params.filter((param) => param.type === "int" || param.type === "float");
  if (numbers.length === 1) return numbers[0];
  const bare = bare_word_param(command);
  return bare && !is_dynamic_values(bare.values) ? bare : undefined;
}

// The required `strict` string params that are not the subject. The command line fills them from the bare words in schema order, ahead of the subject: `set hint_letters asdf` gives `name` then `value`.
export function positional_params(command: Pick<CommandDef, "params">): ParamDef[] {
  return (command.params ?? []).filter((param) => param.type === "string" && param.strict === true && !param.main && !param.when && declared_default(param) === undefined);
}

// The params typed as flags: all but the subject, the positional words and the engine that takes the first bare word.
export function flag_params(command: Pick<CommandDef, "params">): ParamDef[] {
  const subject = subject_param(command);
  const bare = bare_word_param(command);
  const positional = positional_params(command);
  return (command.params ?? []).filter((param) => param !== subject && !positional.includes(param) && !(param === bare && is_dynamic_values(param.values)));
}

export function find_param(command: Pick<CommandDef, "params">, name: string): ParamDef | undefined {
  return (command.params ?? []).find((param) => param.name === name);
}

export function join_alternatives(values: readonly ParamValue[]): string {
  const words = values.map(String);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}
