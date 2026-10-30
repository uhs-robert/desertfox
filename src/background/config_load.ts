// Picks the config the extension runs on: managed storage, then an imported
// file in `storage.local`, then defaults.

import { CONFIG_FORMAT_VERSION } from "../shared/config.ts";
import type { MergedConfig } from "../shared/config.ts";
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

// Fills sections the file left out, so later code never checks for undefined.
function with_all_sections(raw: Record<string, unknown>): MergedConfig {
  return { ...empty_config(), ...raw, format_version: CONFIG_FORMAT_VERSION } as MergedConfig;
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
    return { config: with_all_sections(candidate), source, warnings };
  }
  return { config: empty_config(), source: "defaults", warnings };
}

export async function load_config(): Promise<LoadedConfig> {
  // Firefox rejects the read when no managed file exists, which is the normal case without a config.
  const managed = await browser.storage.managed.get().catch(() => undefined);
  const stored = await browser.storage.local.get(IMPORTED_CONFIG_STORAGE_KEY);
  return pick_config(managed, stored[IMPORTED_CONFIG_STORAGE_KEY]);
}
