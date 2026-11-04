// Turns the stored config status and warnings into plain rows for the status page. No DOM here, so tests read the rows.

import { MODES } from "../shared/command.ts";
import type { CommandMeta } from "../shared/command.ts";
import type { Settings } from "../shared/config.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";

export type ConfigSource = "managed" | "imported" | "defaults";

// The value the background stores under CONFIG_STATUS_STORAGE_KEY.
// `overrides` names the settings `:set` changed live. `configured` names the ones the config file sets. Both are absent in a status stored by an older version.
export type ConfigStatus = { source: ConfigSource; settings: Settings; managed_file_hint: string; overrides?: string[]; configured?: string[] };

// `tag` is set on a value that differs from the default: where the difference came from.
export type SettingTag = "settings.toml" | "set";

export type SettingRow = { name: string; value: string; tag?: SettingTag };

export type CommandRow = { id: string; label: string; intent: string };

export type OptionsModel = {
  source_text: string;
  settings: SettingRow[];
  commands: CommandRow[];
  warnings: string[];
  keymap_warning_count: number;
  rebuild_steps: string[];
};

const SOURCE_TEXT: Record<ConfigSource, string> = {
  managed: "Managed storage file",
  imported: "Imported config",
  defaults: "Built-in defaults, no config found",
};

const FALLBACK_MANAGED_FILE = "~/.mozilla/managed-storage/oasisfox@uhs-robert.json";

// Keymap warnings start with the mode name, config warnings with "config".
const KEYMAP_WARNING = new RegExp(`^(${[...MODES, "browser"].join("|")}): `);

function show_value(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : (JSON.stringify(value) ?? "unset");
}

// Walks the stored settings, so a setting added later shows without a change here.
// An unset optional setting is absent from the object and so absent from the rows.
// A live `:set` tag wins over the config file tag, because it is the value in force.
function setting_rows(settings: Settings, overrides: readonly string[] = [], configured: readonly string[] = []): SettingRow[] {
  return Object.entries(settings).map(([name, value]) => {
    const differs = JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[name as keyof Settings]);
    const tag: SettingTag | undefined = !differs ? undefined : overrides.includes(name) ? "set" : configured.includes(name) ? "settings.toml" : undefined;
    return { name, value: show_value(value), ...(tag ? { tag } : {}) };
  });
}

export function build_options_model(status: ConfigStatus | undefined, warnings: string[], commands: CommandMeta[] = []): OptionsModel {
  const managed_file = status?.managed_file_hint || FALLBACK_MANAGED_FILE;
  return {
    source_text: status ? SOURCE_TEXT[status.source] : "Unknown, the background has not written a status yet",
    settings: setting_rows(status?.settings ?? DEFAULT_SETTINGS, status?.overrides, status?.configured),
    commands: commands.map(({ id, label, intent }) => ({ id, label, intent })).sort((a, b) => a.id.localeCompare(b.id)),
    warnings,
    keymap_warning_count: warnings.filter((warning) => KEYMAP_WARNING.test(warning)).length,
    rebuild_steps: ["just build-config", `writes ${managed_file}`, "then run config.reload (key qr)"],
  };
}
