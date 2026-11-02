// Compiles the merged keymap into the prefix tree the content script walks.

import type { CountBehavior, RunsIn } from "../command.ts";
import { COMPILED_KEYMAP_VERSION } from "../prefix_tree.ts";
import type { CompiledKeymap, LeafStep, TreeBranch } from "../prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../config.ts";
import type { Settings } from "../config.ts";
import type { KeyBinding } from "../invocation.ts";
import type { KeymapConfig, KeymapMode } from "../keymap.ts";
import { parse_sequence } from "./notation.ts";

export type CommandInfo = { runs_in: RunsIn; label: string; count: CountBehavior };

// Returns undefined for an id the registry does not know.
export type ResolveCommand = (command_id: string) => CommandInfo | undefined;

export type CompileResult = { compiled: CompiledKeymap; warnings: string[] };

type Entry = { sequence: string; tokens: string[]; binding: KeyBinding; source_index: number };

const MODES: KeymapMode[] = ["normal", "insert", "ignore", "hint", "cmdline", "browser"];

// Explicit bindings win over generated ones, so generated entries go in first.
function generated_bindings(keymap: KeymapConfig, settings: Partial<Settings>): Record<string, KeyBinding> {
  const search_prefixes = { ...DEFAULT_SETTINGS.search_prefixes, ...settings.search_prefixes };
  const container_prefixes = { ...DEFAULT_SETTINGS.container_prefixes, ...settings.container_prefixes };
  const bindings: Record<string, KeyBinding> = {};
  for (const [last_key, engine] of Object.entries(keymap.search_keys ?? {})) {
    bindings[search_prefixes.here + last_key] = { id: "open.search", args: { engine, where: "here" } };
    bindings[search_prefixes.tab + last_key] = { id: "open.search", args: { engine, where: "tab" } };
  }
  for (const [last_key, container] of Object.entries(keymap.container_keys ?? {})) {
    bindings[container_prefixes.reopen + last_key] = { id: "tab.reopen_in_container", args: { container } };
    bindings[container_prefixes.tab + last_key] = { id: "open.url", args: { where: "tab", container } };
  }
  return bindings;
}

function entries_for_mode(
  mode: KeymapMode,
  keymap: KeymapConfig,
  settings: Partial<Settings>,
  warnings: string[],
): Entry[] {
  const sources = [mode === "normal" ? generated_bindings(keymap, settings) : {}, keymap[mode] ?? {}];
  const by_normalized_sequence = new Map<string, Entry>();
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
      } else {
        const earlier = by_normalized_sequence.get(normalized);
        if (earlier && earlier.source_index === source_index) {
          warnings.push(`${mode}: "${sequence}" and "${earlier.sequence}" are the same keys, kept "${sequence}"`);
        }
        by_normalized_sequence.set(normalized, { sequence, tokens: parsed.tokens, binding, source_index });
      }
    }
  }
  // Shorter sequences first, so a prefix claims its place before the longer entries below it.
  return [...by_normalized_sequence.values()].sort((a, b) => a.tokens.length - b.tokens.length);
}

function to_steps(mode: KeymapMode, entry: Entry, resolve: ResolveCommand, warnings: string[]) {
  const invocations = Array.isArray(entry.binding) ? entry.binding : [entry.binding];
  const steps: LeafStep[] = [];
  let label: string | undefined;
  for (const invocation of invocations) {
    const info = resolve(invocation.id);
    if (!info) {
      warnings.push(`${mode}: skipped "${entry.sequence}": unknown command "${invocation.id}"`);
      return undefined;
    }
    label ??= info.label;
    steps.push({ invocation, runs_in: info.runs_in, count_rule: info.count });
  }
  if (steps.length === 0) {
    warnings.push(`${mode}: skipped "${entry.sequence}": empty binding`);
    return undefined;
  }
  return { steps, label };
}

function insert_entry(root: TreeBranch, mode: KeymapMode, entry: Entry, resolve: ResolveCommand, warnings: string[]) {
  const resolved = to_steps(mode, entry, resolve, warnings);
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

export function compile_keymap(keymap: KeymapConfig, settings: Partial<Settings>, resolve: ResolveCommand): CompileResult {
  const warnings: string[] = [];
  const modes: CompiledKeymap["modes"] = {};
  for (const mode of MODES) {
    const root: TreeBranch = { kind: "branch", children: {} };
    for (const entry of entries_for_mode(mode, keymap, settings, warnings)) {
      insert_entry(root, mode, entry, resolve, warnings);
    }
    if (Object.keys(root.children).length > 0) modes[mode] = root;
  }
  const compiled: CompiledKeymap = {
    format_version: COMPILED_KEYMAP_VERSION,
    modes,
    ignore_sites: settings.ignore_sites ?? DEFAULT_SETTINGS.ignore_sites,
    mode_indicator: settings.mode_indicator ?? DEFAULT_SETTINGS.mode_indicator,
    which_key_delay_ms: settings.which_key_delay_ms ?? DEFAULT_SETTINGS.which_key_delay_ms,
  };
  return { compiled, warnings };
}
