// Checks merged data against `commands.json`. This is a build-time subset of
// the registry validator: ids, param names, types and enum values. The
// background runs the real validator when it loads the config.

import type { CommandMeta, ParamDef } from "../../src/shared/command.ts";
import type { SnippetEntry } from "../../src/shared/config.ts";
import { is_plain_object } from "./errors.ts";
import { origin_key, type MergedData } from "./merge.ts";

const COMMAND_ID = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const CONTEXT_SOURCE_NAMES = ["current_url", "selection", "clipboard"];

type KnownCommands = Map<string, CommandMeta | SnippetEntry>;

function describe_value(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function check_arg(param: ParamDef, value: unknown, engine_names: Set<string>): string | undefined {
  if (is_plain_object(value) && "from" in value) {
    const is_source = Object.keys(value).length === 1 && CONTEXT_SOURCE_NAMES.includes(String(value.from));
    if (!is_source) return `a context source is {"from": ${CONTEXT_SOURCE_NAMES.map((n) => `"${n}"`).join(" | ")}}`;
    return param.type === "string" ? undefined : `a context source fits only a string param, "${param.name}" is ${param.type}`;
  }
  const dynamic = !Array.isArray(param.values) ? (param.values as { from?: string } | undefined)?.from : undefined;
  switch (param.type) {
    case "int":
      return Number.isInteger(value) ? undefined : `"${param.name}" must be an integer, got ${describe_value(value)}`;
    case "float":
      return typeof value === "number" && Number.isFinite(value) ? undefined : `"${param.name}" must be a number, got ${describe_value(value)}`;
    case "bool":
      return typeof value === "boolean" ? undefined : `"${param.name}" must be true or false, got ${describe_value(value)}`;
    case "string":
    case "enum": {
      if (typeof value !== "string") return `"${param.name}" must be a string, got ${describe_value(value)}`;
      if (param.type === "enum" && Array.isArray(param.values) && !param.values.includes(value)) {
        return `"${param.name}" must be one of ${param.values.join(", ")}, got "${value}"`;
      }
      if (dynamic === "search_engines" && !engine_names.has(value)) {
        return `"${param.name}" names the search engine "${value}", which search_engines.jsonc does not define`;
      }
      if (dynamic === "containers" && value === "") return `"${param.name}" must not be empty`;
      return undefined;
    }
  }
}

function check_when(param: ParamDef, params: readonly ParamDef[], args: Record<string, unknown>): string | undefined {
  if (!param.when) return undefined;
  const [[sibling_name, allowed] = []] = Object.entries(param.when);
  if (!sibling_name || !allowed) return undefined;
  const sibling_default = params.find((p) => p.name === sibling_name)?.default;
  const effective = sibling_name in args ? args[sibling_name] : sibling_default;
  if (is_plain_object(effective)) return undefined;
  if (!allowed.includes(effective as string)) {
    return `"${param.name}" is valid only when ${sibling_name} is ${allowed.join(" or ")}, it is ${describe_value(effective)}`;
  }
  return undefined;
}

function check_invocation(invocation: unknown, commands: KnownCommands, engine_names: Set<string>): string[] {
  if (!is_plain_object(invocation)) return ["a binding is an invocation object or an array of them"];
  const errors: string[] = [];
  for (const key of Object.keys(invocation)) {
    if (!["id", "args", "count"].includes(key)) errors.push(`unknown field "${key}" (known: id, args, count)`);
  }
  if (invocation.count !== undefined && !(Number.isInteger(invocation.count) && (invocation.count as number) >= 1)) {
    errors.push(`count must be a positive integer, got ${describe_value(invocation.count)}`);
  }
  if (typeof invocation.id !== "string") return [...errors, "id must be a string"];

  const command = commands.get(invocation.id);
  if (!command) return [...errors, `unknown command id "${invocation.id}"`];

  const args = invocation.args ?? {};
  if (!is_plain_object(args)) return [...errors, "args must be an object"];
  const params = command.params ?? [];
  for (const [arg_name, value] of Object.entries(args)) {
    const param = params.find((p) => p.name === arg_name);
    if (!param) {
      errors.push(`${invocation.id} has no param "${arg_name}" (params: ${params.map((p) => p.name).join(", ") || "none"})`);
      continue;
    }
    const type_error = check_arg(param, value, engine_names);
    if (type_error) errors.push(`${invocation.id}: ${type_error}`);
    else {
      const when_error = check_when(param, params, args);
      if (when_error) errors.push(`${invocation.id}: ${when_error}`);
    }
  }
  return errors;
}

export function check_snippet_entries(snippets: SnippetEntry[], commands: CommandMeta[], files: string[], problems: string[]) {
  const command_groups = new Set(commands.map((command) => command.id.split(".")[0]));
  const taken_ids = new Set(commands.map((command) => command.id));
  const taken_names = new Map<string, string>();
  for (const command of commands) {
    for (const name of [command.name, ...(command.aliases ?? [])]) if (name) taken_names.set(name, command.id);
  }

  for (const [index, snippet] of snippets.entries()) {
    const file = files[index] ?? "snippet";
    if (!COMMAND_ID.test(snippet.id)) {
      problems.push(`${file}: id "${snippet.id}" must be group.name, lowercase with underscores`);
      continue;
    }
    if (command_groups.has(snippet.id.split(".")[0])) {
      problems.push(`${file}: id "${snippet.id}" uses the group "${snippet.id.split(".")[0]}", which OasisFox commands use`);
    }
    if (taken_ids.has(snippet.id)) problems.push(`${file}: id "${snippet.id}" is already taken`);
    taken_ids.add(snippet.id);
    for (const name of [snippet.name, ...(snippet.aliases ?? [])]) {
      if (!name) continue;
      const owner = taken_names.get(name);
      if (owner) problems.push(`${file}: command line name "${name}" is already used by ${owner}`);
      taken_names.set(name, snippet.id);
    }
  }
}

export function check_merged(
  merged: MergedData,
  snippets: SnippetEntry[],
  commands: CommandMeta[],
  problems: string[],
) {
  const known: KnownCommands = new Map();
  for (const command of [...commands, ...snippets]) known.set(command.id, command);
  const engine_names = new Set(Object.keys(merged.search_engines));
  const where = (section: string, key: string) => {
    const file = merged.origins.get(origin_key(section, key)) ?? "config";
    return `${file}: ${section.replace(/^keymap\./, "keymap ")} "${key}"`;
  };

  for (const [mode, bindings] of Object.entries(merged.keymap)) {
    if (mode === "search_keys") {
      for (const [key, engine] of Object.entries(merged.keymap.search_keys ?? {})) {
        if (!engine_names.has(engine)) problems.push(`${where("keymap.search_keys", key)}: unknown search engine "${engine}"`);
      }
      continue;
    }
    if (mode === "container_keys") continue;
    for (const [sequence, binding] of Object.entries(bindings as Record<string, unknown>)) {
      if (binding === null) continue;
      const invocations = Array.isArray(binding) ? binding : [binding];
      if (invocations.length === 0) problems.push(`${where(`keymap.${mode}`, sequence)}: an empty array runs nothing`);
      for (const invocation of invocations) {
        for (const error of check_invocation(invocation, known, engine_names)) {
          problems.push(`${where(`keymap.${mode}`, sequence)}: ${error}`);
        }
      }
    }
  }

  const taken_names = new Set<string>();
  for (const command of known.values()) {
    for (const name of [command.name, ...(command.aliases ?? [])]) if (name) taken_names.add(name);
  }
  for (const [alias, target] of Object.entries(merged.command_aliases)) {
    const location = where("command_aliases", alias);
    if (/\s/.test(alias)) problems.push(`${location}: an alias cannot contain whitespace`);
    if (known.has(alias) || taken_names.has(alias)) problems.push(`${location}: the name is already used by a command`);
    if (!known.has(target)) problems.push(`${location}: unknown command id "${target}"`);
  }
}
