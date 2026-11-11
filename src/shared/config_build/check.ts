// Checks merged data against `commands.json`. Commands and snippets go through
// the real registry, so they get the define-time checks. Binding strings are
// parsed by the registry's grammar, then go through `check_args`. A binding
// that leaves out a required param needs a `prompt`, as it does at load.

import type { CommandMeta, Mode } from "../command.ts";
import { DEFAULT_SETTINGS, with_fallback_engines, type SnippetEntry } from "../config.ts";
import { intent_problem, label_problem, to_firefox_shortcut, parse_sequence } from "../keys/index.ts";
import { captured_key_param, find_param, without_param } from "../registry/params.ts";
import { check_args, create_registry, DefineError, type Registry } from "../registry/index.ts";
import { parse_binding } from "../registry/parse_binding.ts";
import type { BoundInvocation, Prompt } from "../invocation.ts";
import type { Modifier } from "../keymap.ts";
import { origin_key, type MergedData } from "./merge.ts";

const no_op = () => {};

export function build_registry(commands: CommandMeta[], snippets: SnippetEntry[], snippet_files: string[], problems: string[]): Registry {
  const registry = create_registry();
  const define = (source: string, entry: CommandMeta & { runs_in: "background" | "content" }) => {
    const { id, ...input } = entry;
    try {
      registry.define(id, entry.runs_in === "background" ? { ...input, runs_in: "background", run: no_op } : { ...input, runs_in: "content" });
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
      problems.push(`${file}: id "${snippet.id}" uses the group "${group}", which DesertFox commands use`);
      continue;
    }
    const { matches: _matches, requires: _requires, code: _code, ...meta } = snippet;
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

  // A key param the binding leaves out is captured from the key press, so the rest is checked without it.
  const captured = captured_key_param(command, invocation.args);
  const result = check_args(captured ? without_param(command, captured.name) : command, invocation.args, { search_engines: engine_names });
  // With a prompt, the prompted param may be left out.
  if (!result.ok && !(invocation.prompt !== undefined && result.missing_param !== undefined)) errors.push(result.error);
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
export function resolve_bindings(merged: MergedData, registry: Registry, problems: string[]) {
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
    else return result.binding;
  };
  // A step that is not text is an invocation the file already holds, as a saved edit exports it.
  const resolve_step = (step: string | BoundInvocation, where: string): BoundInvocation | undefined => (typeof step === "string" ? resolve_text(step, where) : step);
  const resolve_run = (run: string | BoundInvocation | readonly (string | BoundInvocation)[], where: string): BoundInvocation | BoundInvocation[] | undefined => {
    if (!Array.isArray(run)) return resolve_step(run as string | BoundInvocation, where);
    const parsed = run.map((step) => resolve_step(step, where));
    return parsed.every((binding) => binding !== undefined) ? parsed : undefined;
  };
  // One binding in any keymap format. Undefined when a step failed, which is already reported. The label and the intent sit on the first invocation, as the compiler reads them there.
  const resolve_entry = (entry: unknown, where: string): BoundInvocation | BoundInvocation[] | undefined => {
    if (!is_labeled_binding(entry)) return resolve_run(entry as string | BoundInvocation | BoundInvocation[], where);
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
  for (const [mode, entries] of Object.entries(merged.keymap)) {
    if (mode === "search_keys" || mode === "container_keys" || mode === "site_keys" || mode === "modifiers" || mode === "group_names") continue;
    const bindings = entries as Record<string, unknown>;
    for (const [sequence, entry] of Object.entries(bindings)) {
      if (typeof entry !== "string" && !Array.isArray(entry) && !is_labeled_binding(entry)) continue;
      const binding = resolve_entry(entry, location(mode, sequence));
      if (binding) bindings[sequence] = binding;
    }
  }
  // Site binds take the same formats. Row by row, the settings check already vouched for the shape.
  const site_where = location_of(merged, "settings", "site_rules");
  for (const row of merged.settings.site_rules ?? []) {
    for (const [sequence, entry] of Object.entries(row.bind ?? {})) {
      const binding = resolve_entry(entry, `${site_where}: bind "${sequence}" of "${row.site}"`);
      if (binding) (row.bind as Record<string, unknown>)[sequence] = binding;
    }
  }
}

function is_labeled_binding(entry: unknown): entry is { run: string | BoundInvocation | readonly (string | BoundInvocation)[]; label?: string; intent?: string } {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) && "run" in entry;
}

// A fallback must name an engine, and following fallbacks must end.
function check_engine_fallbacks(merged: MergedData, where: (section: string, key: string) => string, problems: string[]) {
  const engines = with_fallback_engines(merged.search_engines);
  for (const [name, engine] of Object.entries(engines)) {
    if (engine.fallback === undefined) continue;
    if (!Object.hasOwn(engines, engine.fallback)) {
      problems.push(`${where("search_engines", name)}: engine "${name}" has fallback "${engine.fallback}", which is not an engine`);
      continue;
    }
    const chain = [name];
    for (let next: string | undefined = engine.fallback; next !== undefined; next = engines[next]?.fallback) {
      if (chain.includes(next)) {
        problems.push(`${where("search_engines", name)}: fallbacks loop: ${[...chain, next].join(" -> ")}`);
        break;
      }
      chain.push(next);
    }
  }
}

// A keyword picks one engine, so two engines cannot share it. The format is checked where the engine resolves.
function check_engine_keywords(merged: MergedData, where: (section: string, key: string) => string, problems: string[]) {
  const owner_of = new Map<string, string>();
  for (const [name, engine] of Object.entries(merged.search_engines)) {
    if (engine.keyword === undefined) continue;
    const owner = owner_of.get(engine.keyword);
    if (owner === undefined) owner_of.set(engine.keyword, name);
    else problems.push(`${where("search_engines", name)}: keyword "${engine.keyword}" is already the keyword of engine "${owner}"`);
  }
}

const hosts_overlap = (left: string[] | undefined, right: string[] | undefined): boolean =>
  left === undefined || right === undefined || left.some((host) => right.includes(host));

// One letter means one search on any site, so the engines of a letter must never both fit one page.
// An engine with no hosts fits every site. Slots do not prove two engines exclusive, so only the hosts count.
function check_site_keys(site_keys: Record<string, string[]>, merged: MergedData, where: (section: string, key: string) => string, problems: string[]) {
  const engines = with_fallback_engines(merged.search_engines);
  for (const [letter, names] of Object.entries(site_keys)) {
    const location = where("keymap.site_keys", letter);
    const parsed = parse_sequence(letter);
    if (parsed.error !== undefined) problems.push(`${location}: ${parsed.error}`);
    else if (parsed.tokens.length !== 1) problems.push(`${location}: must be one key, not a sequence`);
    else if (letter === "/") problems.push(`${location}: "/" is reserved for the search of the current site (s//)`);
    const known = names.filter((name) => {
      const exists = Object.hasOwn(engines, name);
      if (!exists) problems.push(`${location}: unknown search engine "${name}"`);
      return exists;
    });
    for (const [index, name] of known.entries()) {
      for (const other of known.slice(index + 1)) {
        if (hosts_overlap(engines[name]!.hosts, engines[other]!.hosts)) {
          problems.push(`${location}: "${name}" and "${other}" fit the same site, so one key cannot tell them apart. Give them different hosts or different keys`);
        }
      }
    }
  }
}

function check_modifiers(modifiers: Record<string, Modifier>, where: (section: string, key: string) => string, problems: string[]) {
  for (const [sequence, { label }] of Object.entries(modifiers)) {
    const location = where("keymap.modifiers", sequence);
    const parsed = parse_sequence(sequence);
    if (parsed.error !== undefined) problems.push(`${location}: ${parsed.error}`);
    else if (parsed.tokens.length < 2) problems.push(`${location}: a modifier must sit inside a group, for example ";r"`);
    const label_error = label === undefined ? null : typeof label === "string" ? label_problem(label) : "a label must be a string";
    if (label_error) problems.push(`${location}: ${label_error}`);
  }
}

// The user dropped both generated site search keys, so a `search_keys` letter `/` takes their place.
function site_search_keys_unbound(merged: MergedData): boolean {
  const prefixes = { ...DEFAULT_SETTINGS.search_prefixes, ...merged.settings.search_prefixes };
  const normal = (merged.keymap.normal ?? {}) as Record<string, unknown>;
  return [prefixes.here, prefixes.tab].every((prefix) => normal[`${prefix}//`] === null);
}

export function check_config(merged: MergedData, registry: Registry, problems: string[], warnings: string[]) {
  const engine_names = Object.keys(with_fallback_engines(merged.search_engines));
  const where = (section: string, key: string) => location_of(merged, section, key);

  // A leading dash would read as a flag, so the engine could only be named with --engine=.
  for (const name of Object.keys(merged.search_engines)) {
    if (name.startsWith("-")) warnings.push(`${where("search_engines", name)}: engine "${name}" starts with "-", so a command line can name it only as --engine=${name}`);
  }

  // The settings check covers the shape of each bind. Each step gets the checks of a keymap entry.
  for (const row of merged.settings.site_rules ?? []) {
    for (const [sequence, entry] of Object.entries(row.bind ?? {})) {
      for (const step of [entry].flat() as unknown[]) {
        // Text here failed to parse, and resolve_bindings already reported it.
        if (typeof step !== "object" || step === null || is_labeled_binding(step)) continue;
        const binding = step as BoundInvocation;
        const prefix = `${where("settings", "site_rules")}: bind "${sequence}" of "${row.site}"`;
        const command = registry.get(binding.id);
        if (command && captured_key_param(command, binding.args)) {
          problems.push(`${prefix}: a bind cannot wait for a key press`);
          continue;
        }
        for (const message of check_invocation(binding, registry, engine_names, "normal")) problems.push(`${prefix}: ${message}`);
      }
    }
  }

  const default_engine = merged.settings.default_engine;
  if (default_engine !== undefined && !engine_names.includes(default_engine)) {
    const file = merged.origins.get(origin_key("settings", "default_engine")) ?? "config";
    problems.push(`${file}: default_engine: unknown search engine "${default_engine}"`);
  }
  // Typed text with no page behind it goes to this engine, so it cannot need a page slot.
  const default_slots = default_engine === undefined ? undefined : with_fallback_engines(merged.search_engines)[default_engine]?.slots;
  if (default_slots && default_slots.length > 0) {
    const file = merged.origins.get(origin_key("settings", "default_engine")) ?? "config";
    problems.push(`${file}: default_engine "${default_engine}" needs the page slot ${default_slots.map((slot) => `{${slot}}`).join(", ")}`);
  }

  check_engine_fallbacks(merged, where, problems);
  check_engine_keywords(merged, where, problems);

  for (const [mode, entries] of Object.entries(merged.keymap)) {
    if (mode === "group_names") {
      for (const sequence of Object.keys(entries as Record<string, string>)) {
        const parsed = parse_sequence(sequence);
        if (parsed.error !== undefined) problems.push(`${where("keymap.group_names", sequence)}: ${parsed.error}`);
      }
      continue;
    }
    if (mode === "modifiers") {
      check_modifiers(entries as Record<string, Modifier>, where, problems);
      continue;
    }
    if (mode === "site_keys") {
      check_site_keys(entries as Record<string, string[]>, merged, where, problems);
      continue;
    }
    if (mode === "search_keys" || mode === "container_keys") {
      for (const [key, name] of Object.entries(entries as Record<string, string>)) {
        if (mode === "search_keys" && key === "/" && !site_search_keys_unbound(merged)) {
          problems.push(`${where("keymap.search_keys", key)}: "/" is the key of the current site search (s// and S//), which would win over "${name}". Use another letter for "${name}", or unbind both with "s//" = "" and "S//" = "" under [normal]`);
        }
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
        // A string or a labeled table here failed to parse, and resolve_bindings already reported it.
        if (typeof invocation === "string" || is_labeled_binding(invocation)) continue;
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
