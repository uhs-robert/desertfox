// Picks the config the extension runs on: the files `config.reload` last built, kept in `storage.local`,
// then managed storage, then defaults.

import { apply_edits, CONFIG_FORMAT_VERSION, effective_settings, NO_EDITS, with_fallback_engines } from "../shared/config.ts";
import type { MergedConfig, SettingEdits, SettingOverrides, Settings, SnippetEntry } from "../shared/config.ts";
import { is_setting_name, SETTING_SPECS } from "../shared/settings_schema.ts";
import { FILES_CONFIG_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "./storage_keys.ts";

export type ConfigSource = "files" | "managed" | "defaults";

// The value the background stores under CONFIG_STATUS_STORAGE_KEY.
// `saved` and `temp` name the settings each layer of browser edits sets. `configured` names the ones the config file sets.
export type ConfigStatus = { source: ConfigSource; settings: Settings; managed_file_hint: string; saved: string[]; temp: string[]; configured: string[] };

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

// `build-config` refuses a bad setting, but a hand-edited or older managed file can still hold one. Dropping it lets the default apply.
function checked_file_settings(stored: unknown, source: ConfigSource, warnings: string[]): Partial<Settings> {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const kept = Object.entries(stored).filter(([name, value]) => {
    if (!is_setting_name(name)) {
      warnings.push(`config (${source}): setting ${name} skipped, no setting has that name`);
      return false;
    }
    if (!SETTING_SPECS[name].check(value)) {
      warnings.push(`config (${source}): setting ${name} skipped, expected ${SETTING_SPECS[name].expectation}`);
      return false;
    }
    return true;
  });
  return Object.fromEntries(kept) as Partial<Settings>;
}

// Fills sections the file left out, so later code never checks for undefined.
function with_all_sections(raw: Record<string, unknown>, source: ConfigSource, warnings: string[]): MergedConfig {
  const merged = { ...empty_config(), ...raw, format_version: CONFIG_FORMAT_VERSION } as MergedConfig;
  merged.settings = checked_file_settings(raw.settings, source, warnings);
  const default_engine = merged.settings?.default_engine;
  merged.search_engines = with_fallback_engines(merged.search_engines ?? {}, default_engine);
  const default_needs_page = default_engine !== undefined && (merged.search_engines[default_engine]?.slots ?? []).length > 0;
  if (default_needs_page) warnings.push(`config (${source}): default_engine "${default_engine}" needs a page slot, so the built-in site engine searches with DuckDuckGo`);
  const listed: unknown[] = Array.isArray(merged.snippets) ? merged.snippets : [];
  merged.snippets = listed.filter((candidate, index) => {
    const usable = is_usable_snippet(candidate);
    if (!usable) warnings.push(`config (${source}): snippet ${index + 1} skipped, it needs id, label, intent, code and a non-empty matches list`);
    return usable;
  }) as SnippetEntry[];
  return merged;
}

// The files win: a `config.reload` cannot clear the managed file, and Firefox serves it until the extension restarts.
export function pick_config(files: unknown, managed: unknown): LoadedConfig {
  const warnings: string[] = [];
  const candidates: [ConfigSource, unknown][] = [
    ["files", files],
    ["managed", managed],
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
  const stored = await browser.storage.local.get(FILES_CONFIG_STORAGE_KEY);
  return pick_config(stored[FILES_CONFIG_STORAGE_KEY], managed);
}

// Keeps what the schema accepts. A stored value that no longer passes, from an older version, is dropped rather than trusted.
export function checked_edit_layer(stored: unknown): SettingOverrides {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const kept = Object.entries(stored).filter(([name, value]) => is_setting_name(name) && SETTING_SPECS[name].settable && SETTING_SPECS[name].check(value));
  return Object.fromEntries(kept) as SettingOverrides;
}

export async function load_edits(): Promise<SettingEdits> {
  const [saved, temp] = await Promise.all([browser.storage.local.get(SAVED_SETTINGS_STORAGE_KEY), browser.storage.session.get(TEMP_SETTINGS_STORAGE_KEY)]);
  return { saved: checked_edit_layer(saved[SAVED_SETTINGS_STORAGE_KEY]), temp: checked_edit_layer(temp[TEMP_SETTINGS_STORAGE_KEY]) };
}

export async function store_edits(edits: SettingEdits): Promise<void> {
  await Promise.all([browser.storage.local.set({ [SAVED_SETTINGS_STORAGE_KEY]: edits.saved }), browser.storage.session.set({ [TEMP_SETTINGS_STORAGE_KEY]: edits.temp })]);
}

export const with_edits = (config: MergedConfig, edits: SettingEdits = NO_EDITS): MergedConfig => ({ ...config, settings: apply_edits(config.settings, edits) });

// The config the extension runs on: the loaded one with the browser edits over its settings. Pages that read the config themselves use this.
export async function load_effective_config(): Promise<{ config: MergedConfig; source: ConfigSource; edits: SettingEdits; config_settings: MergedConfig["settings"] }> {
  const [loaded, edits] = await Promise.all([load_config(), load_edits()]);
  return { config: with_edits(loaded.config, edits), source: loaded.source, edits, config_settings: loaded.config.settings };
}

// `config_settings` is the config before the edits, so the status can tell which differing value came from where.
export function build_config_status(source: ConfigSource, config_settings: MergedConfig["settings"], edits: SettingEdits, managed_file_hint: string): ConfigStatus {
  return {
    source,
    settings: effective_settings(apply_edits(config_settings, edits)),
    managed_file_hint,
    saved: Object.keys(edits.saved),
    temp: Object.keys(edits.temp),
    configured: Object.keys(config_settings),
  };
}
