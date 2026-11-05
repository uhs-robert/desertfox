// Picks the config the extension runs on: managed storage, then an imported
// file in `storage.local`, then defaults.

import { apply_overrides, CONFIG_FORMAT_VERSION, effective_settings, with_fallback_engines } from "../shared/config.ts";
import type { MergedConfig, SettingOverrides, SnippetEntry } from "../shared/config.ts";
import type { ConfigStatus } from "../options/model.ts";
import { is_setting_name, SETTING_SPECS } from "../shared/settings_schema.ts";
import { IMPORTED_CONFIG_STORAGE_KEY, SETTING_OVERRIDES_STORAGE_KEY } from "./storage_keys.ts";

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
    search_engines: with_fallback_engines({}),
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
  merged.search_engines = with_fallback_engines(merged.search_engines ?? {});
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

// Keeps what the schema accepts. A stored value that no longer passes, from an older version, is dropped rather than trusted.
export function checked_overrides(stored: unknown): SettingOverrides {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const kept = Object.entries(stored).filter(([name, value]) => is_setting_name(name) && !SETTING_SPECS[name].is_group && SETTING_SPECS[name].check(value));
  return Object.fromEntries(kept) as SettingOverrides;
}

export async function load_overrides(): Promise<SettingOverrides> {
  const stored = await browser.storage.session.get(SETTING_OVERRIDES_STORAGE_KEY);
  return checked_overrides(stored[SETTING_OVERRIDES_STORAGE_KEY]);
}

export const with_overrides = (config: MergedConfig, overrides: SettingOverrides): MergedConfig => ({ ...config, settings: apply_overrides(config.settings, overrides) });

// The config the extension runs on: the loaded one with the live `:set` values over its settings. Pages that read the config themselves use this.
export async function load_effective_config(): Promise<{ config: MergedConfig; source: ConfigSource; overrides: SettingOverrides; config_settings: MergedConfig["settings"] }> {
  const [loaded, overrides] = await Promise.all([load_config(), load_overrides()]);
  return { config: with_overrides(loaded.config, overrides), source: loaded.source, overrides, config_settings: loaded.config.settings };
}

// `config_settings` is the config before the overrides, so the status can tell which differing value came from where.
export function build_config_status(source: ConfigSource, config_settings: MergedConfig["settings"], overrides: SettingOverrides, managed_file_hint: string): ConfigStatus {
  return {
    source,
    settings: effective_settings(apply_overrides(config_settings, overrides)),
    managed_file_hint,
    overrides: Object.keys(overrides),
    configured: Object.keys(config_settings),
  };
}
