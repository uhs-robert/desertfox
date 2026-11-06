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

// A tag shows on any edited name, even one whose value equals the default.
export function build_setting_list(status: LayerStatus): SettingListRow[] {
  return SETTING_NAMES.map((name) => {
    const row = SETTINGS_TABLE[name];
    const spec = SETTING_SPECS[name];
    const allowed = row.kind === "enum" || row.kind === "enum_list" ? row.values : spec.listed_values?.();
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
