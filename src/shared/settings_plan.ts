import type { MergedConfig, SettingEdits, SettingOverrides, Settings } from "./config.ts";
import { effective_settings } from "./config.ts";
import type { ToastKind } from "./messages/tab.ts";
import { is_consent_setting, parse_setting_text } from "./settings_schema.ts";
import { built_in_theme_names } from "./theme/load.ts";
import { DESKTOP_THEME } from "./theme/roles.ts";

// The pure planners of `:set`, `:toggle` and `:unset` and the settings page: edits in, edits and the answering toast out. The commands and the settings page message both run them.

export type Toast = { kind: ToastKind; message: string };

// What a `:set`, `:toggle` or `:unset` comes to: the edits to keep (absent for no change) and the toast that answers it.
export type SettingsPlan = { next?: SettingEdits; toast: Toast };

// `saved` lasts and takes only the consent settings. `temp` ends when the browser restarts.
export type EditLayer = "saved" | "temp";

export const show = (name: string, value: unknown): string => (value === undefined ? `${name} is not set` : `${name} = ${JSON.stringify(value)}`);

const UNTIL_RESTART = " until the browser restarts";

function without(layer: SettingOverrides, name: keyof Settings): SettingOverrides {
  const { [name]: _removed, ...rest } = layer;
  return rest;
}

// A saved edit drops the temp edit of the same name. Otherwise the temp edit keeps winning and the save shows no effect.
// Every other setting lasts in settings.toml, so the saved layer refuses it. A value an older version saved there stays until an unset or the start fold takes it out.
function edit_with(current: SettingEdits, layer: EditLayer, name: keyof Settings, value: unknown): SettingEdits {
  if (layer === "temp") return { saved: current.saved, temp: { ...current.temp, [name]: value } };
  if (!is_consent_setting(name)) throw new Error(`${name} is not kept in the browser. Only the consent settings are.`);
  return { saved: { ...current.saved, [name]: value }, temp: without(current.temp, name) };
}

// The build tool only warns about these two, so a live change does the same.
function naming_nothing(name: keyof Settings, value: unknown, config: MergedConfig): string | undefined {
  if (name === "default_engine" && typeof value === "string" && !Object.hasOwn(config.search_engines, value)) return `no search engine is named "${value}"`;
  if (name === "theme" && typeof value === "string" && value !== DESKTOP_THEME && !built_in_theme_names().includes(value) && !Object.hasOwn(config.local_themes ?? {}, value)) return `no theme is named "${value}"`;
  return undefined;
}

// The params already hold valid text: `name` is a known setting that `set` takes, and `value` passed that setting's check.
// `config` is the config under the edits now in force.
export function plan_set(name: keyof Settings, value_text: string, layer: EditLayer, current: SettingEdits, config: MergedConfig): SettingsPlan {
  if (value_text.trim() === "") return { toast: { kind: "info", message: show(name, effective_settings(config.settings)[name]) } };
  const { value } = parse_setting_text(name, value_text) as { value: unknown };
  return plan_set_value(name, value, layer, current, config);
}

// The settings page sends a typed value, so it skips the text guess of `plan_set`. The caller has run `SETTING_SPECS[name].check` on it.
export function plan_set_value(name: keyof Settings, value: unknown, layer: EditLayer, current: SettingEdits, config: MergedConfig): SettingsPlan {
  return { next: edit_with(current, layer, name, value), toast: set_toast(name, value, layer === "temp" ? UNTIL_RESTART : "", config) };
}

// `name = value`, then `note` (how long it lasts or where it went), then a warning when the value names nothing.
export function set_toast(name: keyof Settings, value: unknown, note: string, config: MergedConfig): Toast {
  const unmatched = naming_nothing(name, value, config);
  const message = unmatched === undefined ? `${show(name, value)}${note}` : `${show(name, value)}${note}, but ${unmatched}`;
  return { kind: unmatched === undefined ? "success" : "warning", message };
}

export function plan_toggle(name: keyof Settings, layer: EditLayer, current: SettingEdits, config: MergedConfig): SettingsPlan {
  const flipped = !effective_settings(config.settings)[name];
  const until = layer === "temp" ? UNTIL_RESTART : "";
  return { next: edit_with(current, layer, name, flipped), toast: { kind: "success", message: `${show(name, flipped)}${until}` } };
}

const count_words = (count: number): string => `${count} ${count === 1 ? "edit" : "edits"}`;

// Without `--temp`, unset drops the saved and the temp edit, so the config file value applies. With it, only the temp edit goes.
export function plan_unset(name: keyof Settings | "all", only_temp: boolean, current: SettingEdits): SettingsPlan {
  const kept_saved = (saved: SettingOverrides) => (only_temp ? current.saved : saved);
  if (name === "all") {
    const count = Object.keys(current.temp).length + (only_temp ? 0 : Object.keys(current.saved).length);
    if (count === 0) return { toast: { kind: "info", message: only_temp ? "No settings have a temp edit" : "No settings are edited" } };
    return { next: { saved: kept_saved({}), temp: {} }, toast: { kind: "success", message: `Cleared ${count_words(count)}` } };
  }
  const edited = Object.hasOwn(current.temp, name) || (!only_temp && Object.hasOwn(current.saved, name));
  if (!edited) return { toast: { kind: "info", message: only_temp ? `${name} has no temp edit` : `${name} is not edited` } };
  return { next: { saved: kept_saved(without(current.saved, name)), temp: without(current.temp, name) }, toast: { kind: "success", message: `Unset ${name}` } };
}
