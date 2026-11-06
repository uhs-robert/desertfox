// Turns the config status into plain rows for the help page's Home. No DOM here, so tests read the rows.

import type { ConfigSource, ConfigStatus } from "../background/config_load.ts";
import type { Settings } from "../shared/config.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { SettingListRow } from "../shared/messages.ts";
import { SETTING_NAMES, SETTING_SPECS } from "../shared/settings_schema.ts";
import { SETTINGS_TABLE } from "../shared/settings_table.ts";

// `tag` is set on a value that differs from the default: where the difference came from.
export type SettingTag = "settings.toml" | "saved" | "temp";

export type SettingRow = { name: string; value: string; tag?: SettingTag };

export type ConfigView = {
  source_text: string;
  settings: SettingRow[];
  rebuild_steps: string[];
};

const SOURCE_TEXT: Record<ConfigSource, string> = {
  managed: "Managed storage file",
  imported: "Imported config",
  defaults: "Built-in defaults, no config found",
};

const FALLBACK_MANAGED_FILE = "~/.mozilla/managed-storage/desertfox@uhs-robert.json";

function show_value(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : (JSON.stringify(value) ?? "unset");
}

function default_of(name: string): unknown {
  return DEFAULT_SETTINGS[name as keyof Settings];
}

// The layer whose value is in force: temp, then saved, then the config file. Absent means the built-in default.
export function top_layer_of(status: ConfigStatus | undefined, name: string): SettingTag | undefined {
  return status?.temp.includes(name) ? "temp" : status?.saved.includes(name) ? "saved" : status?.configured.includes(name) ? "settings.toml" : undefined;
}

// Walks the stored settings, so a setting added later shows without a change here.
// Every setting except `home_page` has a default, so each shows a row. `home_page` has none and is absent until set.
// The tag names the top layer that sets the value, because that value is in force: temp, then saved, then the config file.
function setting_rows(settings: Settings, status: ConfigStatus | undefined): SettingRow[] {
  const top_layer = (name: string) => top_layer_of(status, name);
  return Object.entries(settings).map(([name, value]) => {
    const differs = JSON.stringify(value) !== JSON.stringify(default_of(name));
    const tag = differs ? top_layer(name) : undefined;
    return { name, value: show_value(value), ...(tag ? { tag } : {}) };
  });
}

export function build_config_view(status: ConfigStatus | undefined): ConfigView {
  const managed_file = status?.managed_file_hint || FALLBACK_MANAGED_FILE;
  return {
    source_text: status ? SOURCE_TEXT[status.source] : "Unknown, the background has not written a status yet",
    settings: setting_rows(status?.settings ?? DEFAULT_SETTINGS, status),
    rebuild_steps: ["just build-config", `writes ${managed_file}`, "then run config.reload (key qr)"],
  };
}

// Every setting with its typed value, for the settings page. A tag shows on any edited name, even one that equals the default.
export function build_setting_list(status: ConfigStatus): SettingListRow[] {
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
