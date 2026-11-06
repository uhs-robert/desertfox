// Merges the layers of each data kind. `search_keys`, `container_keys` and `site_keys` stay
// as written: the background's keymap compiler expands them.
// A later layer wins per key. Nothing here knows the command list, so binding
// strings stay strings until `resolve_bindings` in check.ts parses them.

import { MODES } from "../command.ts";
import type { SearchEngine, Settings } from "../config.ts";
import { nodes_of_file, resolve_engines } from "../engines/index.ts";
import type { EngineNode } from "../engines/index.ts";
import type { KeymapConfig, ModeBindings } from "../keymap.ts";
import { is_plain_object } from "./errors.ts";
import { is_setting_name, SETTING_NAMES, SETTING_SPECS } from "../settings_schema.ts";
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
  const generator_sections = ["search_keys", "container_keys", "site_keys", "modifiers", "group_names"];

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
        if (section === "site_keys") {
          if (!Array.isArray(entry) || entry.length === 0 || !entry.every((name) => typeof name === "string" && name !== "")) {
            problems.push(`${layer.file}: site_keys["${key}"] must be a non-empty list of engine names`);
            continue;
          }
          target[key] = entry;
          origins.set(origin_key(`keymap.${section}`, key), layer.file);
          continue;
        }
        if (section === "modifiers") {
          if (!is_plain_object(entry) || Object.keys(entry).length === 0 || !Object.values(entry).every((arg) => ["string", "number", "boolean"].includes(typeof arg))) {
            problems.push(`${layer.file}: modifiers["${key}"] must be a table of args, for example { rapid = true, label = "Rapid" }`);
            continue;
          }
          target[key] = entry;
          origins.set(origin_key(`keymap.${section}`, key), layer.file);
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

function merge_settings(layers: DataLayer[], origins: Origins, problems: string[]) {
  return merge_map_layers(layers, "settings", origins, problems, (value, where, name) => {
    if (!is_setting_name(name)) {
      problems.push(`${where}: unknown setting (known: ${SETTING_NAMES.join(", ")})`);
      return false;
    }
    const valid = SETTING_SPECS[name].check(value);
    if (!valid) {
      const detail = SETTING_SPECS[name].explain?.(value);
      problems.push(`${where}: expected ${SETTING_SPECS[name].expectation}${detail ? `, but ${detail}` : ""}`);
    }
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
