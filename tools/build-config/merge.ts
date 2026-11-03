// Merges the layers of each data kind. `search_keys` and `container_keys` stay
// as written: the background's keymap compiler expands them.
// A later layer wins per key. Nothing here knows the command list, so binding
// strings stay strings until `resolve_bindings` in check.ts parses them.

import { MODES } from "../../src/shared/command.ts";
import { MODE_INDICATOR_VALUES, WHICH_KEY_BORDER_VALUES } from "../../src/shared/config.ts";
import type { SearchEngine, Settings } from "../../src/shared/config.ts";
import { nodes_of_file, resolve_engines } from "../../src/shared/engines/index.ts";
import type { EngineNode } from "../../src/shared/engines/index.ts";
import { is_palette_name, PALETTE_NAMES } from "../../src/shared/mode_colors.ts";
import type { KeymapConfig, ModeBindings } from "../../src/shared/keymap.ts";
import { is_plain_object } from "./errors.ts";
import type { DataLayer } from "./source_files.ts";

export const KEYMAP_MODES = [...MODES, "browser"] as const;

// Where each merged entry came from, so a later check can name the file and key.
export type Origins = Map<string, string>;

export type MergedData = {
  keymap: KeymapConfig;
  search_engines: Record<string, SearchEngine>;
  command_aliases: Record<string, string>;
  settings: Partial<Settings>;
  origins: Origins;
};

export function origin_key(section: string, key: string): string {
  return `${section}\u0000${key}`;
}

function merge_map_layers(
  layers: DataLayer[],
  section: string,
  origins: Origins,
  problems: string[],
  accept: (value: unknown, where: string, key: string) => boolean,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.data)) {
      if (!accept(value, `${layer.file}: ${key}`, key)) continue;
      merged[key] = value;
      origins.set(origin_key(section, key), layer.file);
    }
  }
  return merged;
}

function merge_keymap(layers: DataLayer[], origins: Origins, problems: string[]): KeymapConfig {
  const merged: Record<string, Record<string, unknown>> = {};
  const generator_sections = ["search_keys", "container_keys", "group_names"];

  for (const layer of layers) {
    for (const [section, value] of Object.entries(layer.data)) {
      const is_mode = (KEYMAP_MODES as readonly string[]).includes(section);
      if (!is_mode && !generator_sections.includes(section)) {
        problems.push(
          `${layer.file}: unknown keymap section "${section}" (known: ${[...KEYMAP_MODES, ...generator_sections].join(", ")})`,
        );
        continue;
      }
      if (!is_plain_object(value)) {
        problems.push(`${layer.file}: keymap section "${section}" must be an object`);
        continue;
      }
      const target = (merged[section] ??= {});
      for (const [key, entry] of Object.entries(value)) {
        if (key === "") {
          problems.push(`${layer.file}: keymap.${section} has an empty key`);
          continue;
        }
        if (generator_sections.includes(section) && (typeof entry !== "string" || entry === "")) {
          problems.push(`${layer.file}: ${section}["${key}"] must be a non-empty string`);
          continue;
        }
        if (!generator_sections.includes(section) && !is_command_text(entry)) {
          problems.push(`${layer.file}: keymap.${section}["${key}"] must be a command string, "" to unbind, a list of command strings, or { run = "...", label = "..." }`);
          continue;
        }
        // TOML has no null: "" is the unbind marker, stored as null.
        target[key] = entry === "" ? null : entry;
        origins.set(origin_key(`keymap.${section}`, key), layer.file);
      }
    }
  }
  return merged as KeymapConfig;
}

function is_command_text(entry: unknown): boolean {
  if (typeof entry === "string") return true;
  if (is_plain_object(entry)) {
    const only_known_fields = Object.keys(entry).every((key) => key === "run" || key === "label");
    const has_run = typeof entry.run === "string" ? entry.run !== "" : Array.isArray(entry.run) && is_command_text(entry.run);
    return only_known_fields && has_run && (entry.label === undefined || typeof entry.label === "string");
  }
  return Array.isArray(entry) && entry.length > 0 && entry.every((item) => typeof item === "string" && item.trim() !== "");
}

// Engines are a tree of tables. A later file replaces the table at the same dotted path and leaves the parent
// and the other children alone, so origins stay per engine.
function merge_search_engines(layers: DataLayer[], origins: Origins, problems: string[]): Record<string, SearchEngine> {
  const by_path = new Map<string, EngineNode>();
  for (const layer of layers) {
    for (const node of nodes_of_file(layer.file, layer.data, problems)) by_path.set(node.path, node);
  }
  const resolved = resolve_engines([...by_path.values()]);
  problems.push(...resolved.problems);
  for (const name of Object.keys(resolved.engines)) {
    // A generated child has no table of its own: it comes from the nearest table above it.
    for (let path = name; path !== ""; path = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "") {
      const node = by_path.get(path);
      if (node) {
        origins.set(origin_key("search_engines", name), node.file);
        break;
      }
    }
  }
  return resolved.engines;
}

function merge_command_aliases(layers: DataLayer[], origins: Origins, problems: string[]) {
  return merge_map_layers(layers, "command_aliases", origins, problems, (value, where) => {
    const valid = typeof value === "string" && value !== "";
    if (!valid) problems.push(`${where}: an alias maps to a command id string`);
    return valid;
  }) as Record<string, string>;
}

const SETTING_CHECKS: Record<keyof Settings, (value: unknown) => boolean> = {
  which_key_delay_ms: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  which_key_border: (value) => (WHICH_KEY_BORDER_VALUES as readonly unknown[]).includes(value),
  hint_letters: (value) => typeof value === "string" && new Set(value).size === value.length && value.length >= 2,
  ignore_sites: (value) => Array.isArray(value) && value.every((site) => typeof site === "string" && site !== ""),
  mode_indicator: (value) => (MODE_INDICATOR_VALUES as readonly unknown[]).includes(value),
  palette: is_palette_name,
  search_prefixes: (value) => is_prefix_pair(value, "here"),
  container_prefixes: (value) => is_prefix_pair(value, "reopen"),
  home_page: (value) => typeof value === "string" && value !== "",
  default_engine: (value) => typeof value === "string" && value !== "",
  new_tab_page: (value) => typeof value === "string",
};

const SETTING_EXPECTATIONS: Record<keyof Settings, string> = {
  which_key_delay_ms: "a number of milliseconds, 0 or more",
  which_key_border: '"square", "round" or "chamfer"',
  hint_letters: "a string of 2 or more distinct letters",
  ignore_sites: "a list of match pattern strings",
  mode_indicator: '"always", "not_normal" or "off"',
  palette: `one of ${PALETTE_NAMES.join(", ")}`,
  search_prefixes: '{"here": "...", "tab": "..."} with non-empty strings',
  container_prefixes: '{"reopen": "...", "tab": "..."} with non-empty strings',
  home_page: "a non-empty URL string",
  default_engine: "the name of a search engine",
  new_tab_page: "a string",
};

function is_prefix_pair(value: unknown, first_key: string): boolean {
  if (!is_plain_object(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join() !== [first_key, "tab"].sort().join()) return false;
  return Object.values(value).every((prefix) => typeof prefix === "string" && prefix !== "");
}

function merge_settings(layers: DataLayer[], origins: Origins, problems: string[]) {
  return merge_map_layers(layers, "settings", origins, problems, (value, where, name) => {
    if (!Object.hasOwn(SETTING_CHECKS, name)) {
      problems.push(`${where}: unknown setting (known: ${Object.keys(SETTING_CHECKS).join(", ")})`);
      return false;
    }
    const setting = name as keyof Settings;
    const valid = SETTING_CHECKS[setting](value);
    if (!valid) problems.push(`${where}: expected ${SETTING_EXPECTATIONS[setting]}`);
    return valid;
  }) as Partial<Settings>;
}

export function merge_layers(layers: Record<string, DataLayer[]>, problems: string[]): MergedData {
  const origins: Origins = new Map();
  const keymap = merge_keymap(layers.keymap ?? [], origins, problems);
  const settings = merge_settings(layers.settings ?? [], origins, problems);

  return {
    keymap,
    search_engines: merge_search_engines(layers.search_engines ?? [], origins, problems),
    command_aliases: merge_command_aliases(layers.command_aliases ?? [], origins, problems),
    settings,
    origins,
  };
}
