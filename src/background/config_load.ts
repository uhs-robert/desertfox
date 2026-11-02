// Picks the config the extension runs on: managed storage, then an imported
// file in `storage.local`, then defaults.

import { CONFIG_FORMAT_VERSION } from "../shared/config.ts";
import type { MergedConfig, SnippetEntry } from "../shared/config.ts";
import { IMPORTED_CONFIG_STORAGE_KEY } from "./storage_keys.ts";

export type ConfigSource = "managed" | "imported" | "defaults";

export type LoadedConfig = {
  config: MergedConfig;
  source: ConfigSource;
  warnings: string[];
};

export function empty_config(): MergedConfig {
  return {
    format_version: CONFIG_FORMAT_VERSION,
    keymap: {},
    search_engines: {},
    command_aliases: {},
    settings: {},
    snippets: [],
    css: "",
  };
}

function is_config_object(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null && Object.keys(candidate).length > 0;
}

// A hand-edited or imported file can hold a snippet that run time code cannot use. Running only checked entries keeps the match list a hard gate.
function is_usable_snippet(candidate: unknown): candidate is SnippetEntry {
  if (typeof candidate !== "object" || candidate === null) return false;
  const entry = candidate as Record<string, unknown>;
  const is_text = (value: unknown) => typeof value === "string" && value !== "";
  return (
    is_text(entry.id) &&
    is_text(entry.label) &&
    is_text(entry.intent) &&
    typeof entry.code === "string" &&
    Array.isArray(entry.matches) &&
    entry.matches.length > 0 &&
    entry.matches.every(is_text)
  );
}

// Fills sections the file left out, so later code never checks for undefined.
function with_all_sections(raw: Record<string, unknown>, source: ConfigSource, warnings: string[]): MergedConfig {
  const merged = { ...empty_config(), ...raw, format_version: CONFIG_FORMAT_VERSION } as MergedConfig;
  const listed: unknown[] = Array.isArray(merged.snippets) ? merged.snippets : [];
  merged.snippets = listed.filter((candidate, index) => {
    const usable = is_usable_snippet(candidate);
    if (!usable) warnings.push(`config (${source}): snippet ${index + 1} skipped, it needs id, label, intent, code and a non-empty matches list`);
    return usable;
  }) as SnippetEntry[];
  return merged;
}

export function pick_config(managed: unknown, imported: unknown): LoadedConfig {
  const warnings: string[] = [];
  const candidates: [ConfigSource, unknown][] = [
    ["managed", managed],
    ["imported", imported],
  ];
  for (const [source, candidate] of candidates) {
    if (!is_config_object(candidate)) continue;
    if (candidate.format_version !== CONFIG_FORMAT_VERSION) {
      warnings.push(`config (${source}): skipped, format_version ${String(candidate.format_version)} is not ${CONFIG_FORMAT_VERSION}`);
      continue;
    }
    return { config: with_all_sections(candidate, source, warnings), source, warnings };
  }
  return { config: empty_config(), source: "defaults", warnings };
}

export async function load_config(): Promise<LoadedConfig> {
  // Firefox rejects the read when no managed file exists, which is the normal case without a config.
  const managed = await browser.storage.managed.get().catch(() => undefined);
  const stored = await browser.storage.local.get(IMPORTED_CONFIG_STORAGE_KEY);
  return pick_config(managed, stored[IMPORTED_CONFIG_STORAGE_KEY]);
}
