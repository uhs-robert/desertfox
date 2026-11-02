// The one validator. Keys, the command line, the native host and snippets
// all end here.

import type { CheckedArgs, CommandDef, DynamicValues, ParamDef, ParamValue } from "../command.ts";
import {
  find_param,
  is_context_source,
  is_dynamic_values,
  join_alternatives,
  static_values,
} from "./params.ts";

// Lists for enum params whose values come from a runtime source. The caller
// (background page, native host, test) reads them from Firefox or the config.
// A missing list skips the membership check, so tools without Firefox can
// still check types.
export type EnumSources = Partial<Record<DynamicValues["from"], readonly string[]>>;

export type CheckResult =
  | { ok: true; args: CheckedArgs }
  | {
      ok: false;
      error: string;
      // Set when the only problem is a required param left out, so the command line can ask for it.
      missing_param?: string;
    };

export function check_args(
  command: Pick<CommandDef, "id" | "params">,
  raw_args: Record<string, unknown> | undefined,
  sources: EnumSources = {},
): CheckResult {
  const raw = raw_args ?? {};
  const params = command.params ?? [];

  for (const key of Object.keys(raw)) {
    if (!find_param(command, key)) return fail(`${command.id}: unknown arg "${key}"`);
  }

  const args: CheckedArgs = {};
  for (const param of params) {
    const given = raw[param.name];
    if (given === undefined) continue;
    const coerced = coerce(param, given, sources);
    if (!coerced.ok) return fail(coerced.error);
    args[param.name] = coerced.value;
  }

  // Params with `when` come last in this pass: their condition reads a sibling's final value, defaults included.
  for (const param of params) {
    if (!param.when && args[param.name] === undefined && param.default !== undefined) args[param.name] = param.default;
  }
  for (const param of params) {
    if (!param.when) continue;
    const explicit = args[param.name] !== undefined;
    const value = explicit ? args[param.name] : param.default;
    if (value === undefined) continue;
    const error = when_error(command, param, args);
    if (error && explicit) return fail(error);
    if (!error) args[param.name] = value;
  }
  for (const param of params) {
    if (args[param.name] === undefined && !param.when) {
      return { ok: false, error: `missing <${param.name}>`, missing_param: param.name };
    }
  }
  return { ok: true, args };
}

function fail(error: string): CheckResult {
  return { ok: false, error };
}

type Coerced = { ok: true; value: unknown } | { ok: false; error: string };

function coerce(param: ParamDef, given: unknown, sources: EnumSources): Coerced {
  const bad = (expected: string): Coerced => ({
    ok: false,
    error: `${param.name} expects ${expected}, got ${JSON.stringify(given)}`,
  });

  if (param.type === "string" && is_context_source(given)) return { ok: true, value: given };

  switch (param.type) {
    case "string":
      return typeof given === "string" ? { ok: true, value: given } : bad("text");
    case "int": {
      const number = typeof given === "string" && /^-?\d+$/.test(given) ? Number(given) : given;
      return Number.isInteger(number) ? { ok: true, value: number } : bad("a whole number");
    }
    case "float": {
      const number = typeof given === "string" && given.trim() !== "" ? Number(given) : given;
      return typeof number === "number" && Number.isFinite(number) ? { ok: true, value: number } : bad("a number");
    }
    case "bool": {
      if (typeof given === "boolean") return { ok: true, value: given };
      if (given === "true") return { ok: true, value: true };
      if (given === "false") return { ok: true, value: false };
      return bad("true or false");
    }
    case "enum": {
      if (typeof given !== "string") return bad("text");
      const allowed = enum_values(param, sources);
      if (allowed && !allowed.includes(given)) return bad(`one of ${allowed.join(", ")}`);
      return { ok: true, value: given };
    }
  }
}

function enum_values(param: ParamDef, sources: EnumSources): readonly string[] | undefined {
  return is_dynamic_values(param.values) ? sources[param.values.from] : static_values(param);
}

function when_error(command: Pick<CommandDef, "params">, param: ParamDef, args: CheckedArgs): string | null {
  const [sibling_name, allowed] = Object.entries(param.when ?? {})[0] as [string, readonly ParamValue[]];
  const sibling_value = args[sibling_name];
  if (is_context_source(sibling_value)) return null;
  if (sibling_value !== undefined && allowed.includes(sibling_value as ParamValue)) return null;
  return `${param.name} needs ${sibling_name} ${join_alternatives(allowed)}`;
}
