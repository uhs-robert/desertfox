// Checks merged data against `commands.json`. Commands and snippets go through
// the real registry, so they get the define-time checks. Binding strings are
// parsed by the registry's grammar, then go through `check_args`, with one
// difference: a missing param is valid, because it is how a binding asks for
// the prompt.

import type { CommandMeta, Mode } from "../../src/shared/command.ts";
import { with_fallback_engines, type SnippetEntry } from "../../src/shared/config.ts";
import { to_firefox_shortcut, parse_sequence } from "../../src/shared/keys/index.ts";
import { find_param } from "../../src/shared/registry/params.ts";
import { check_args, create_registry, DefineError, type Registry } from "../../src/shared/registry/index.ts";
import { parse_binding } from "../../src/shared/registry/parse_binding.ts";
import type { BoundInvocation, Prompt } from "../../src/shared/invocation.ts";
import { origin_key, type MergedData } from "./merge.ts";

const no_op = () => {};

export function build_registry(commands: CommandMeta[], snippets: SnippetEntry[], snippet_files: string[], problems: string[]): Registry {
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

function check_invocation(invocation: BoundInvocation, registry: Registry, engine_names: string[], mode: string): string[] {
  const errors: string[] = [];
  const command = registry.get(invocation.id);
  if (!command) return [`unknown command id "${invocation.id}"`];

  // Firefox shortcuts fire in the tab's normal mode.
  const runtime_mode = mode === "browser" ? "normal" : mode;
  const allowed = command.modes ?? ["normal"];
  if (!allowed.includes(runtime_mode as Mode)) errors.push(`${command.id} runs in ${allowed.join(", ")} mode, not ${runtime_mode}`);

  const result = check_args(command, invocation.args, { search_engines: engine_names });
  if (!result.ok && result.missing_param === undefined) errors.push(result.error);
  if (invocation.prompt !== undefined) errors.push(...check_prompt(invocation.prompt, command));
  return errors;
}

function check_prompt(prompt: Prompt, command: CommandMeta): string[] {
  const errors: string[] = [];
  const param = find_param(command, prompt.param);
  if (!param) {
    const names = (command.params ?? []).map((candidate) => candidate.name).join(", ") || "none";
    errors.push(`param "${prompt.param}" is not a param of ${command.id} (params: ${names})`);
  } else if (prompt.prefill !== undefined && param.type !== "string") {
    errors.push(`${prompt.prefill ? `@${prompt.prefill.from}` : "a source"} needs a string param, "${param.name}" is ${param.type}`);
  }
  return errors;
}

function key_error(mode: string, sequence: string): string | undefined {
  if (mode === "browser") return to_firefox_shortcut(sequence).error;
  return parse_sequence(sequence).error;
}

function location_of(merged: MergedData, section: string, key: string): string {
  const file = merged.origins.get(origin_key(section, key)) ?? "config";
  return `${file}: ${section.replace(/^keymap\./, "keymap ")} "${key}"`;
}

// Turns the binding strings of every mode into invocations, in place. The
// extension and the stored file only ever see invocations.
export function resolve_bindings(merged: MergedData, registry: Registry, problems: string[], warnings: string[]) {
  const sources = { search_engines: Object.keys(with_fallback_engines(merged.search_engines)) };
  const location = (mode: string, sequence: string) => location_of(merged, `keymap.${mode}`, sequence);
  // Aliases that check_config rejects (spaces, a taken word, an unknown target) stay out, so they are reported once, there.
  const with_aliases: Registry = {
    ...registry,
    find: (word) => {
      const found = registry.find(word);
      const target = merged.command_aliases[word];
      return found ?? (target !== undefined && !/\s/.test(word) ? registry.get(target) : undefined);
    },
  };
  const resolve_text = (text: string, where: string): BoundInvocation | undefined => {
    const result = parse_binding(with_aliases, text, sources);
    if (result.kind === "error") problems.push(`${where}: ${result.error}`);
    else {
      for (const warning of result.warnings ?? []) warnings.push(`${where}: ${warning}`);
      return result.binding;
    }
  };
  for (const [mode, entries] of Object.entries(merged.keymap)) {
    if (mode === "search_keys" || mode === "container_keys") continue;
    const bindings = entries as Record<string, unknown>;
    for (const [sequence, entry] of Object.entries(bindings)) {
      if (typeof entry === "string") {
        const binding = resolve_text(entry, location(mode, sequence));
        if (binding) bindings[sequence] = binding;
      } else if (Array.isArray(entry)) {
        const parsed = entry.map((text: string) => resolve_text(text, location(mode, sequence)));
        if (parsed.every((binding) => binding !== undefined)) bindings[sequence] = parsed;
      }
    }
  }
}

export function check_config(merged: MergedData, registry: Registry, problems: string[]) {
  const engine_names = Object.keys(with_fallback_engines(merged.search_engines));
  const where = (section: string, key: string) => location_of(merged, section, key);

  const default_engine = merged.settings.default_engine;
  if (default_engine !== undefined && !engine_names.includes(default_engine)) {
    const file = merged.origins.get(origin_key("settings", "default_engine")) ?? "config";
    problems.push(`${file}: default_engine: unknown search engine "${default_engine}"`);
  }

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
      for (const invocation of invocations) {
        // A string here failed to parse, and resolve_bindings already reported it.
        if (typeof invocation === "string") continue;
        for (const message of check_invocation(invocation, registry, engine_names, mode)) problems.push(`${location}: ${message}`);
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
