// Compiles the merged keymap into the prefix tree the content script walks.

import { MODES as RUNTIME_MODES } from "../command.ts";
import type { CountBehavior, ParamDef, RunsIn } from "../command.ts";
import { ignore_regex_source } from "../match_pattern.ts";
import { COMPILED_KEYMAP_VERSION } from "../prefix_tree.ts";
import type { CompiledKeymap, LeafStep, TreeBranch, TreeNode } from "../prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../config.ts";
import type { Settings } from "../config.ts";
import type { BoundInvocation, KeyBinding, Prompt } from "../invocation.ts";
import type { KeymapConfig, KeymapMode, Modifier } from "../keymap.ts";
import { default_of, is_dynamic_values } from "../registry/params.ts";
import { parse_sequence } from "./notation.ts";

// `accepts_args` is the registry validator, passed in because the content bundle includes the keys index: importing the validator here grew content.js from 15.7 KB to 21 KB, over its 16 KB limit. Without it a modifier variant is never judged and always inserted.
export type CommandInfo = { runs_in: RunsIn; label: string; count: CountBehavior; params?: readonly ParamDef[]; accepts_args?: (args: Record<string, unknown>, prompt?: Prompt) => boolean };

// Search engine name to the label the user gave it. A key that searches with an engine reads as that label.
export type LabelSources = { engine_labels: Record<string, string> };

// Returns undefined for an id the registry does not know.
export type ResolveCommand = (command_id: string) => CommandInfo | undefined;

export type CompileResult = { compiled: CompiledKeymap; warnings: string[] };

type Entry = { sequence: string; tokens: string[]; binding: KeyBinding; source_index: number };

// Explicit bindings win over generated ones, so generated entries go in first.
function generated_bindings(keymap: KeymapConfig, settings: Partial<Settings>): Record<string, KeyBinding> {
  const search_prefixes = { ...DEFAULT_SETTINGS.search_prefixes, ...settings.search_prefixes };
  const container_prefixes = { ...DEFAULT_SETTINGS.container_prefixes, ...settings.container_prefixes };
  const bindings: Record<string, KeyBinding> = {};
  for (const [last_key, engine] of Object.entries(keymap.search_keys ?? {})) {
    bindings[search_prefixes.here + last_key] = { id: "open.search", args: { engine, where: "here" } };
    bindings[search_prefixes.tab + last_key] = { id: "open.search", args: { engine, where: "tab" } };
  }
  const site_prefix = (where: "here" | "tab") => search_prefixes[where] + "/";
  for (const [last_key, engines] of Object.entries(keymap.site_keys ?? {})) {
    const first = engines[0];
    if (first === undefined) continue;
    for (const where of ["here", "tab"] as const) {
      bindings[site_prefix(where) + last_key] = { id: "open.search", args: { engine: first, where }, site_search: { letter: last_key, engines } };
    }
  }
  for (const [last_key, container] of Object.entries(keymap.container_keys ?? {})) {
    bindings[container_prefixes.reopen + last_key] = { id: "tab.reopen_in_container", args: { container } };
    bindings[container_prefixes.tab + last_key] = { id: "open.url", args: { where: "tab", container }, prompt: { param: "url", prefill: { from: "current_url" } } };
  }
  return bindings;
}

// Each modifier derives, from every key of its group, a variant with the modifier args added. The group is the modifier key minus its last token.
// A variant exists only when the registry validator accepts its args, so which-key and help never show a combination that would be refused.
// A key that sets its own `action` gets no variants: the modifier would fight it.
// Explicit keys win over variants without a warning, so a user can rebind one variant, or remove it with a null.
function modifier_variants(modifiers: Record<string, Modifier>, taken: Map<string, Entry>, removed: Set<string>, resolve: ResolveCommand, warnings: string[]): Entry[] {
  const parsed_modifiers = Object.entries(modifiers).flatMap(([sequence, { label: _label, ...args }]) => {
    const parsed = parse_sequence(sequence);
    if (parsed.error !== undefined) warnings.push(`modifiers: skipped "${sequence}": ${parsed.error}`);
    else if (parsed.tokens.length < 2) warnings.push(`modifiers: skipped "${sequence}": a modifier must sit inside a group, for example ";r"`);
    else if (taken.has(parsed.tokens.join(""))) warnings.push(`modifiers: skipped "${sequence}": the key has its own binding, which wins`);
    else if (removed.has(parsed.tokens.join(""))) return [];
    else return [{ sequence, tokens: parsed.tokens, args }];
    return [];
  });
  const modifier_keys = parsed_modifiers.map(({ tokens }) => tokens.join(""));
  const sources = [...taken.values()].filter(({ tokens, binding }) => {
    const joined = tokens.join("");
    return !Array.isArray(binding) && binding.args?.action === undefined && !modifier_keys.some((key) => joined.startsWith(key));
  });
  const variants: Entry[] = [];
  for (const { sequence, tokens, args } of parsed_modifiers) {
    const group = tokens.slice(0, -1);
    const in_group = sources.filter((source) => source.tokens.length > group.length && group.every((token, index) => source.tokens[index] === token));
    let accepted = 0;
    for (const source of in_group) {
      const binding = source.binding as BoundInvocation;
      const info = resolve(binding.id);
      const variant_args = { ...binding.args, ...args };
      if (!info || info.accepts_args?.(variant_args, binding.prompt) === false) continue;
      accepted++;
      const variant_tokens = [...group, tokens[tokens.length - 1]!, ...source.tokens.slice(group.length)];
      const variant_key = variant_tokens.join("");
      if (taken.has(variant_key) || removed.has(variant_key)) continue;
      variants.push({ sequence: variant_key, tokens: variant_tokens, binding: { ...binding, args: variant_args, ...(binding.variant_label === undefined ? {} : { label: binding.variant_label }) }, source_index: -1 });
    }
    if (accepted === 0) warnings.push(`modifiers: "${sequence}" matches no key of its group, so it makes no variants`);
  }
  return variants;
}

function entries_for_mode(
  mode: KeymapMode,
  keymap: KeymapConfig,
  settings: Partial<Settings>,
  resolve: ResolveCommand,
  warnings: string[],
): Entry[] {
  const sources = [mode === "normal" ? generated_bindings(keymap, settings) : {}, keymap[mode] ?? {}];
  const by_normalized_sequence = new Map<string, Entry>();
  const removed = new Set<string>();
  for (const [source_index, source] of sources.entries()) {
    for (const [sequence, binding] of Object.entries(source)) {
      const parsed = parse_sequence(sequence);
      if (parsed.error !== undefined) {
        warnings.push(`${mode}: skipped "${sequence}": ${parsed.error}`);
        continue;
      }
      const normalized = parsed.tokens.join("");
      if (binding === null) {
        by_normalized_sequence.delete(normalized);
        removed.add(normalized);
      } else {
        const earlier = by_normalized_sequence.get(normalized);
        if (earlier && earlier.source_index === source_index) {
          warnings.push(`${mode}: "${sequence}" and "${earlier.sequence}" are the same keys, kept "${sequence}"`);
        }
        by_normalized_sequence.set(normalized, { sequence, tokens: parsed.tokens, binding, source_index });
      }
    }
  }
  if (mode === "normal") {
    for (const variant of modifier_variants(keymap.modifiers ?? {}, by_normalized_sequence, removed, resolve, warnings)) {
      by_normalized_sequence.set(variant.tokens.join(""), variant);
    }
  }
  // Shorter sequences first, so a prefix claims its place before the longer entries below it.
  return [...by_normalized_sequence.values()].sort((a, b) => a.tokens.length - b.tokens.length);
}

// The label of a binding is the label its author wrote, else one derived from the command and the args the binding sets.
// The args are the authored ones: defaults the validator fills in later must not show up in the label.
// Prompted params, free strings and numbers are never named. Hand labels cover the keys that set them.
// A value phrase that an ancestor group name already says as whole words is dropped: under "Search in new tab", a row reads "Google", not "Google in new tab".
function derived_label(invocation: BoundInvocation, info: CommandInfo, settings: Partial<Settings>, sources: LabelSources, ancestor_names: string[]): string {
  let label = info.label;
  const phrases: string[] = [];
  for (const param of info.params ?? []) {
    const value = invocation.args?.[param.name];
    if (is_dynamic_values(param.values)) {
      if (param.values.from === "containers" && typeof value === "string" && value !== "") {
        return value === "default" ? "Default container" : value;
      }
      if (param.values.from === "search_engines") {
        const engine = typeof value === "string" && value !== "" ? value : (settings.default_engine ?? DEFAULT_SETTINGS.default_engine);
        label = sources.engine_labels[engine] ?? label;
      }
    } else if (param.type === "enum" && typeof value === "string" && value !== default_of(info, param, invocation.args ?? {})) {
      phrases.push(param.value_labels?.[value] ?? value.replaceAll("_", " "));
    } else if (param.type === "bool" && value === true && value !== default_of(info, param, invocation.args ?? {})) {
      phrases.push(param.name.replaceAll("_", " "));
    }
  }
  return [label, ...phrases.filter((phrase) => !ancestor_names.some((name) => says_phrase(name, phrase)))].join(" ");
}

function says_phrase(name: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(name);
}

// A label is one line of text. Null when `label` is fine.
export function label_problem(label: string): string | null {
  if (label.trim() === "") return "a label must not be empty";
  if (/\p{Cc}/u.test(label)) return "a label must not hold control characters";
  return null;
}

function to_steps(mode: KeymapMode, entry: Entry, resolve: ResolveCommand, settings: Partial<Settings>, sources: LabelSources, ancestor_names: string[], warnings: string[]) {
  const invocations = Array.isArray(entry.binding) ? entry.binding : [entry.binding];
  const steps: LeafStep[] = [];
  let label: string | undefined;
  for (const invocation of invocations) {
    const info = resolve(invocation.id);
    if (!info) {
      warnings.push(`${mode}: skipped "${entry.sequence}": unknown command "${invocation.id}"`);
      return undefined;
    }
    if (label === undefined) {
      const written_problem = invocation.label === undefined ? null : label_problem(invocation.label);
      if (written_problem) {
        warnings.push(`${mode}: skipped "${entry.sequence}": ${written_problem}`);
        return undefined;
      }
      label = invocation.label ?? derived_label(invocation, info, settings, sources, ancestor_names);
      // A derived label can carry a bad engine label or value phrase. The key still works, so it falls back to the command label.
      const derived_problem = invocation.label === undefined ? label_problem(label) : null;
      if (derived_problem) {
        warnings.push(`${mode}: "${entry.sequence}" keeps the command label: ${derived_problem}`);
        label = info.label;
      }
    }
    // The label is for the leaf. The steps stay the plain invocations the router runs.
    const { label: _label, variant_label: _variant_label, ...plain } = invocation;
    steps.push({ invocation: plain, runs_in: info.runs_in, count_rule: info.count });
  }
  if (steps.length === 0) {
    warnings.push(`${mode}: skipped "${entry.sequence}": empty binding`);
    return undefined;
  }
  return { steps, label };
}

function insert_entry(root: TreeBranch, mode: KeymapMode, entry: Entry, resolve: ResolveCommand, settings: Partial<Settings>, sources: LabelSources, group_names: GroupName[], warnings: string[]) {
  const resolved = to_steps(mode, entry, resolve, settings, sources, ancestor_group_names(entry.tokens, group_names), warnings);
  if (!resolved) return;

  let branch = root;
  for (const [depth, token] of entry.tokens.entries()) {
    const is_last = depth === entry.tokens.length - 1;
    const existing = branch.children[token];
    if (!is_last) {
      if (existing?.kind === "leaf") {
        warnings.push(`${mode}: skipped "${entry.sequence}": "${entry.tokens.slice(0, depth + 1).join("")}" is already a complete binding`);
        return;
      }
      branch = existing ?? (branch.children[token] = { kind: "branch", children: {} });
    } else if (existing) {
      warnings.push(`${mode}: skipped "${entry.sequence}": ${existing.kind === "leaf" ? "same keys as another binding" : "another binding already continues past it"}`);
    } else {
      branch.children[token] = { kind: "leaf", ...(resolved.label === undefined ? {} : { label: resolved.label }), steps: resolved.steps };
    }
  }
}

type GroupName = { tokens: string[]; name: string };

// Two spellings of one key sequence name one group. The later one wins, so each group has one name for both the labels and the panel.
function parse_group_names(group_names: Record<string, string>, warnings: string[]): GroupName[] {
  const by_normalized_sequence = new Map<string, GroupName>();
  for (const [sequence, name] of Object.entries(group_names)) {
    const parsed = parse_sequence(sequence);
    if (parsed.error === undefined) by_normalized_sequence.set(parsed.tokens.join(""), { tokens: parsed.tokens, name });
    else warnings.push(`group_names: skipped "${sequence}": ${parsed.error}`);
  }
  return [...by_normalized_sequence.values()];
}

// The names of every group above the key, nearest or not.
function ancestor_group_names(tokens: string[], group_names: GroupName[]): string[] {
  const prefixes = new Set(tokens.slice(0, -1).map((_, index) => tokens.slice(0, index + 1).join("")));
  return group_names.filter(({ tokens: group_tokens }) => prefixes.has(group_tokens.join(""))).map(({ name }) => name);
}

function name_groups(root: TreeBranch, group_names: GroupName[]) {
  for (const { tokens, name } of group_names) {
    let node: TreeNode | undefined = root;
    for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
    if (node?.kind === "branch") node.label = name;
  }
}

export function compile_keymap(keymap: KeymapConfig, settings: Partial<Settings>, resolve: ResolveCommand, label_sources: LabelSources = { engine_labels: {} }): CompileResult {
  const warnings: string[] = [];
  const modes: CompiledKeymap["modes"] = {};
  const keymap_modes: readonly KeymapMode[] = [...RUNTIME_MODES, "browser"];
  const modifier_names = Object.fromEntries(Object.entries(keymap.modifiers ?? {}).flatMap(([sequence, { label }]) => (typeof label === "string" ? [[sequence, label]] : [])));
  const group_names = parse_group_names({ ...modifier_names, ...keymap.group_names }, warnings);
  for (const mode of keymap_modes) {
    const root: TreeBranch = { kind: "branch", children: {} };
    for (const entry of entries_for_mode(mode, keymap, settings, resolve, warnings)) {
      insert_entry(root, mode, entry, resolve, settings, label_sources, group_names, warnings);
    }
    name_groups(root, group_names);
    if (Object.keys(root.children).length > 0) modes[mode] = root;
  }
  const ignore_regex = ignore_regex_source(settings.ignore_sites ?? DEFAULT_SETTINGS.ignore_sites);
  const compiled: CompiledKeymap = {
    format_version: COMPILED_KEYMAP_VERSION,
    modes,
    ...(ignore_regex ? { ignore_regex } : {}),
    mode_indicator: settings.mode_indicator ?? DEFAULT_SETTINGS.mode_indicator,
    which_key_border: settings.which_key_border ?? DEFAULT_SETTINGS.which_key_border,
    which_key_delay_ms: settings.which_key_delay_ms ?? DEFAULT_SETTINGS.which_key_delay_ms,
  };
  return { compiled, warnings };
}
