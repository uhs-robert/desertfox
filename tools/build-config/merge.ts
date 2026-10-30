// Merges the layers of each data kind. `search_keys` and `container_keys` stay
// as written: the background's keymap compiler expands them.
// A later layer wins per key. Nothing here knows the command list.

import { MODE_INDICATOR_VALUES } from "../../src/shared/config.ts";
import type { SearchEngine, Settings } from "../../src/shared/config.ts";
import type { KeymapConfig, ModeBindings } from "../../src/shared/keymap.ts";
import { is_plain_object } from "./errors.ts";
import type { DataLayer } from "./source_files.ts";

export const KEYMAP_MODES = ["normal", "insert", "ignore", "hint", "cmdline", "browser"] as const;

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
  const generator_sections = ["search_keys", "container_keys"];

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
        target[key] = entry;
        origins.set(origin_key(`keymap.${section}`, key), layer.file);
      }
    }
  }
  return merged as KeymapConfig;
}

function merge_search_engines(layers: DataLayer[], origins: Origins, problems: string[]) {
  return merge_map_layers(layers, "search_engines", origins, problems, (value, where) => {
    const valid =
      is_plain_object(value) &&
      typeof value.url === "string" &&
      value.url.includes("%s") &&
      typeof value.label === "string" &&
      value.label !== "" &&
      Object.keys(value).every((key) => key === "url" || key === "label");
    if (!valid) problems.push(`${where}: an engine is {"url": "...%s...", "label": "..."} and nothing else`);
    return valid;
  }) as Record<string, SearchEngine>;
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
  hint_letters: (value) => typeof value === "string" && new Set(value).size === value.length && value.length >= 2,
  ignore_sites: (value) => Array.isArray(value) && value.every((site) => typeof site === "string" && site !== ""),
  mode_indicator: (value) => (MODE_INDICATOR_VALUES as readonly unknown[]).includes(value),
  search_prefixes: (value) => is_prefix_pair(value, "here"),
  container_prefixes: (value) => is_prefix_pair(value, "reopen"),
  home_page: (value) => typeof value === "string" && value !== "",
  default_engine: (value) => typeof value === "string" && value !== "",
  new_tab_page: (value) => typeof value === "string",
};

const SETTING_EXPECTATIONS: Record<keyof Settings, string> = {
  which_key_delay_ms: "a number of milliseconds, 0 or more",
  hint_letters: "a string of 2 or more distinct letters",
  ignore_sites: "a list of match pattern strings",
  mode_indicator: '"always", "not_normal" or "off"',
  search_prefixes: '{"here": "...", "new_tab": "..."} with non-empty strings',
  container_prefixes: '{"reopen": "...", "new_tab": "..."} with non-empty strings',
  home_page: "a non-empty URL string",
  default_engine: "the name of a search engine",
  new_tab_page: "a string",
};

function is_prefix_pair(value: unknown, first_key: string): boolean {
  if (!is_plain_object(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join() !== [first_key, "new_tab"].sort().join()) return false;
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
