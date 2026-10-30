// Checks merged data against `commands.json`. Commands and snippets go through
// the real registry, so they get the define-time checks. Bindings go through
// `check_args`, with one difference: a missing param is valid, because it is how
// a binding asks for the prompt.

import type { CommandMeta } from "../../src/shared/command.ts";
import type { SnippetEntry } from "../../src/shared/config.ts";
import { to_firefox_shortcut, parse_sequence } from "../../src/shared/keys/index.ts";
import { check_args, create_registry, DefineError, type Registry } from "../../src/shared/registry/index.ts";
import { is_plain_object } from "./errors.ts";
import { origin_key, type MergedData } from "./merge.ts";

const no_op = () => {};

function build_registry(commands: CommandMeta[], snippets: SnippetEntry[], snippet_files: string[], problems: string[]): Registry {
  const registry = create_registry();
  const define = (source: string, entry: CommandMeta & { runs_in: "background" | "content" }) => {
    const { id, ...input } = entry;
    try {
      registry.define(id, { ...input, run: no_op });
    } catch (error) {
      if (!(error instanceof DefineError)) throw error;
      problems.push(`${source}: ${error.message}`);
    }
  };

  for (const command of commands) define("commands.json", { ...command, runs_in: "background" });

  const built_in_groups = new Set(registry.list().map((command) => command.id.split(".")[0]));
  for (const [index, snippet] of snippets.entries()) {
    const file = snippet_files[index] ?? "snippet";
    const group = snippet.id.split(".")[0] ?? "";
    if (built_in_groups.has(group)) {
      problems.push(`${file}: id "${snippet.id}" uses the group "${group}", which OasisFox commands use`);
      continue;
    }
    const { matches: _matches, code: _code, ...meta } = snippet;
    define(file, { ...meta, runs_in: "content" });
  }
  return registry;
}

function check_invocation(invocation: unknown, registry: Registry, engine_names: string[]): string[] {
  if (!is_plain_object(invocation)) return ["a binding is an invocation object or an array of them"];
  const errors: string[] = [];
  for (const key of Object.keys(invocation)) {
    if (!["id", "args", "count"].includes(key)) errors.push(`unknown field "${key}" (known: id, args, count)`);
  }
  if (invocation.count !== undefined && !(Number.isInteger(invocation.count) && (invocation.count as number) >= 1)) {
    errors.push(`count must be a positive integer, got ${JSON.stringify(invocation.count)}`);
  }
  if (typeof invocation.id !== "string") return [...errors, "id must be a string"];

  const command = registry.get(invocation.id);
  if (!command) return [...errors, `unknown command id "${invocation.id}"`];
  if (invocation.args !== undefined && !is_plain_object(invocation.args)) return [...errors, "args must be an object"];

  const result = check_args(command, invocation.args as Record<string, unknown> | undefined, { search_engines: engine_names });
  if (!result.ok && result.missing_param === undefined) errors.push(result.error);
  return errors;
}

function key_error(mode: string, sequence: string): string | undefined {
  if (mode === "browser") return to_firefox_shortcut(sequence).error;
  return parse_sequence(sequence).error;
}

export function check_config(
  merged: MergedData,
  snippets: SnippetEntry[],
  snippet_files: string[],
  commands: CommandMeta[],
  problems: string[],
) {
  const registry = build_registry(commands, snippets, snippet_files, problems);
  const engine_names = Object.keys(merged.search_engines);
  const where = (section: string, key: string) => {
    const file = merged.origins.get(origin_key(section, key)) ?? "config";
    return `${file}: ${section.replace(/^keymap\./, "keymap ")} "${key}"`;
  };

  for (const [mode, entries] of Object.entries(merged.keymap)) {
    if (mode === "search_keys" || mode === "container_keys") {
      for (const [key, name] of Object.entries(entries as Record<string, string>)) {
        const parsed = parse_sequence(key);
        if (parsed.error !== undefined) problems.push(`${where(`keymap.${mode}`, key)}: ${parsed.error}`);
        else if (parsed.tokens.length !== 1) problems.push(`${where(`keymap.${mode}`, key)}: must be one key, not a sequence`);
        if (mode === "search_keys" && !engine_names.includes(name)) {
          problems.push(`${where("keymap.search_keys", key)}: unknown search engine "${name}"`);
        }
      }
      continue;
    }
    for (const [sequence, binding] of Object.entries(entries as Record<string, unknown>)) {
      const location = where(`keymap.${mode}`, sequence);
      const error = key_error(mode, sequence);
      if (error) problems.push(`${location}: ${error}`);
      if (binding === null) continue;
      const invocations = Array.isArray(binding) ? binding : [binding];
      if (invocations.length === 0) problems.push(`${location}: an empty array runs nothing`);
      for (const invocation of invocations) {
        for (const message of check_invocation(invocation, registry, engine_names)) problems.push(`${location}: ${message}`);
      }
    }
  }

  for (const [alias, target] of Object.entries(merged.command_aliases)) {
    const location = where("command_aliases", alias);
    if (/\s/.test(alias)) problems.push(`${location}: an alias cannot contain whitespace`);
    if (registry.find(alias)) problems.push(`${location}: the name is already used by a command`);
    if (!registry.get(target)) problems.push(`${location}: unknown command id "${target}"`);
  }
}
