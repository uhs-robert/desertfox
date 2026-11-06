// Turns the config status into plain rows for the help page's Home. No DOM here, so tests read the rows.

import type { ConfigSource, ConfigStatus } from "../background/config_load.ts";
import type { Settings } from "../shared/config.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";

// `tag` is set on a value that differs from the default: where the difference came from.
export type SettingTag = "settings.toml" | "set";

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

// Walks the stored settings, so a setting added later shows without a change here.
// Every setting except `home_page` has a default, so each shows a row. `home_page` has none and is absent until set.
// A live `:set` tag wins over the config file tag, because it is the value in force.
function setting_rows(settings: Settings, overrides: readonly string[] = [], configured: readonly string[] = []): SettingRow[] {
  return Object.entries(settings).map(([name, value]) => {
    const differs = JSON.stringify(value) !== JSON.stringify(default_of(name));
    const tag: SettingTag | undefined = !differs ? undefined : overrides.includes(name) ? "set" : configured.includes(name) ? "settings.toml" : undefined;
    return { name, value: show_value(value), ...(tag ? { tag } : {}) };
  });
}

export function build_config_view(status: ConfigStatus | undefined): ConfigView {
  const managed_file = status?.managed_file_hint || FALLBACK_MANAGED_FILE;
  return {
    source_text: status ? SOURCE_TEXT[status.source] : "Unknown, the background has not written a status yet",
    settings: setting_rows(status?.settings ?? DEFAULT_SETTINGS, status?.overrides, status?.configured),
    rebuild_steps: ["just build-config", `writes ${managed_file}`, "then run config.reload (key qr)"],
  };
}
