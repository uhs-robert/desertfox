// Turns the config status into plain rows for the help page's Home. No DOM here, so tests read the rows.

import type { ConfigSource, ConfigStatus } from "../background/config_load.ts";
import type { Settings } from "../shared/config.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import { top_layer_of } from "../shared/setting_list.ts";
import type { SettingTag } from "../shared/setting_list.ts";

export type { SettingTag };

// `tag` is set on a value that differs from the default: where the difference came from.

export type SettingRow = { name: string; value: string; tag?: SettingTag };

export type ConfigView = {
  source_text: string;
  settings: SettingRow[];
  rebuild_steps: string[];
};

const SOURCE_TEXT: Record<ConfigSource, string> = {
  files: "Config files, read by config.reload through the native host",
  managed: "Managed storage file, until config.reload reads the files",
  defaults: "Built-in defaults, no config found",
};

// The same for every source: `config.reload` reads the files even when managed storage gave the config at startup.
const RELOAD_STEPS = ["native.install (once, to set up the native host)", "config.reload (key qr)"];

function show_value(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : (JSON.stringify(value) ?? "unset");
}

function default_of(name: string): unknown {
  return DEFAULT_SETTINGS[name as keyof Settings];
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
  return {
    source_text: status ? SOURCE_TEXT[status.source] : "Unknown, the background has not written a status yet",
    settings: setting_rows(status?.settings ?? DEFAULT_SETTINGS, status),
    rebuild_steps: RELOAD_STEPS,
  };
}
