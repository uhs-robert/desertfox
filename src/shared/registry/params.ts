// Small readers over a command's params, shared by the define checks, the
// validator, the parser and the usage line.

import type { CommandDef, ContextSource, DefaultArm, DynamicValues, ParamDef, ParamValue } from "../command.ts";

export const CONTEXT_SOURCE_NAMES = ["current_url", "selection", "clipboard"] as const;

export function is_context_source(value: unknown): value is ContextSource {
  if (typeof value !== "object" || value === null) return false;
  const from = (value as { from?: unknown }).from;
  return CONTEXT_SOURCE_NAMES.some((name) => name === from);
}

export type DefaultList = Extract<NonNullable<ParamDef["default"]>, readonly unknown[]>;

export function is_default_list(value: unknown): value is DefaultList {
  return Array.isArray(value);
}

// What the param declares as its default: "" for an optional param, else its `default` field.
export function declared_default(param: ParamDef): ParamDef["default"] {
  return param.optional ? "" : param.default;
}

// The arms of a default list in order, and the plain value last (undefined when the list ends on an arm).
export function split_default(list: DefaultList): { arms: DefaultArm[]; fallback: ParamValue | undefined } {
  const is_arm = (item: unknown): item is DefaultArm => typeof item === "object" && item !== null;
  const last = list[list.length - 1];
  return { arms: list.filter(is_arm), fallback: is_arm(last) ? undefined : last };
}

// The siblings an arm reads, each with the values that make it hold. The arm holds when every one does.
export function arm_conditions(arm: DefaultArm): [string, readonly ParamValue[]][] {
  return Object.entries(arm.when);
}

// The default of a param of `command` once `values` are known, or undefined when it has none and is required.
// A sibling missing from `values` counts by its own resolved default, so defaults may chain. `visiting` stops a cycle that define refuses anyway.
// Every consumer that asks "does this param have a default" or "is it required" goes through here.
export function default_of(command: Pick<CommandDef, "params">, param: ParamDef, values: Record<string, unknown>, visiting: readonly string[] = []): ParamValue | ContextSource | undefined {
  const declared = declared_default(param);
  if (!is_default_list(declared)) return declared;
  const { arms, fallback } = split_default(declared);
  const sibling_value = (name: string): unknown => {
    if (values[name] !== undefined) return values[name];
    const sibling = find_param(command, name);
    return sibling && !visiting.includes(name) ? default_of(command, sibling, values, [...visiting, param.name]) : undefined;
  };
  const arm = arms.find((candidate) => arm_conditions(candidate).every(([name, allowed]) => allowed.includes(sibling_value(name) as ParamValue)));
  return arm ? arm.value : fallback;
}

// Every value the default can take in some context.
export function possible_defaults(param: ParamDef): (ParamValue | ContextSource)[] {
  const declared = declared_default(param);
  if (declared === undefined) return [];
  if (!is_default_list(declared)) return [declared];
  const { arms, fallback } = split_default(declared);
  return [...arms.map((arm) => arm.value), ...(fallback === undefined ? [] : [fallback])];
}

// Whether `value` is the default in every context, so it needs no flag, short, phrase or description: the state without the flag.
// A value that is the default only under some arms is also a choice elsewhere and keeps all four.
export function always_default(param: ParamDef, value: unknown): boolean {
  const declared = declared_default(param);
  if (!is_default_list(declared)) return value === declared;
  return split_default(declared).fallback !== undefined && possible_defaults(param).every((possible) => possible === value);
}

// A default that is a plain value: not a context source, and for a list its plain last value.
export function literal_default(param: ParamDef): ParamValue | undefined {
  const declared = declared_default(param);
  const value = is_default_list(declared) ? split_default(declared).fallback : declared;
  return value === undefined || is_context_source(value) ? undefined : value;
}

// A default as the help page prints it: the plain value first, then each arm in order, an arm with several conditions joined by "and".
export function describe_default(param: ParamDef): string {
  const declared = declared_default(param);
  if (declared === undefined) return "";
  if (is_context_source(declared)) return `from ${declared.from}`;
  if (!is_default_list(declared)) return String(declared);
  const { arms, fallback } = split_default(declared);
  const shown = (value: ParamValue) => (value === "" ? '""' : String(value));
  const described = arms.map((arm) => {
    const conditions = arm_conditions(arm).map(([name, allowed]) => `${name} is ${join_alternatives(allowed)}`);
    return `${shown(arm.value)} when ${conditions.join(" and ")}`;
  });
  return [...(fallback === undefined ? [] : [shown(fallback)]), ...described].join("; ");
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
