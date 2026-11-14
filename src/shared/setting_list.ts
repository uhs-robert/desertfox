// The settings page's view of every setting: typed value, top layer, kind and allowed values. Shared by the background and the help page.

import type { Settings } from "./config.ts";
import type { SettingListRow } from "./messages.ts";
import { SETTING_NAMES, SETTING_SPECS } from "./settings_schema.ts";
import { SETTINGS_TABLE } from "./settings_table.ts";

// The part of `ConfigStatus` that the layers read.
export type LayerStatus = { settings: Settings; saved: string[]; temp: string[]; configured: string[] };

export type SettingTag = "settings.toml" | "saved" | "temp";

// The layer whose value is in force: temp, then saved, then the config file. Absent means the built-in default.
export function top_layer_of(status: Omit<LayerStatus, "settings"> | undefined, name: string): SettingTag | undefined {
  return status?.temp.includes(name) ? "temp" : status?.saved.includes(name) ? "saved" : status?.configured.includes(name) ? "settings.toml" : undefined;
}

// A tag shows on any edited name, even one whose value equals the default. `imported_themes` are the names of the browser's imported themes, which the theme picker offers after the built-in ones.
export function build_setting_list(status: LayerStatus, imported_themes: readonly string[] = []): SettingListRow[] {
  return SETTING_NAMES.map((name) => {
    const row = SETTINGS_TABLE[name];
    const spec = SETTING_SPECS[name];
    const listed = row.kind === "enum" || row.kind === "enum_list" ? row.values : spec.listed_values?.();
    const allowed = name === "theme" && listed ? [...listed, ...imported_themes] : listed;
    return {
      name,
      value: status.settings[name],
      top_layer: top_layer_of(status, name) ?? "default",
      kind: row.kind,
      settable: spec.settable,
      expectation: spec.expectation,
      ...(allowed ? { allowed: [...allowed] } : {}),
    };
  });
}
