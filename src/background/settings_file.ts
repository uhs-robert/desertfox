// A setting written into settings.toml: the edit of the browser copy, and the record of a copy the folder has not caught up with.
// `startup.ts` runs both in the change queue and sends the text to the native host (`write_settings`).

import { parse } from "smol-toml";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { SettingEdits, Settings } from "../shared/config.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { set_top_level_key } from "./toml_key_edit.ts";
import type { TomlScalar } from "./toml_key_edit.ts";
import { SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "./storage_keys.ts";

export const SETTINGS_FILE = "settings.toml";

// A `settings.d` file loads after settings.toml, so a value there would hide the one written.
export function with_setting_in_files(files: ConfigFiles, name: keyof Settings, value: TomlScalar): ConfigFiles {
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith("settings.d/") || !path.endsWith(".toml")) continue;
    if (Object.hasOwn(parse(text), name)) throw new RuntimeRefusal(`${path} sets ${name}, and it wins over ${SETTINGS_FILE}. Change it there.`);
  }
  return { ...files, [SETTINGS_FILE]: set_top_level_key(files[SETTINGS_FILE] ?? "", name, value, SETTINGS_FILE) };
}

// The edits without `name`, so a saved or temp value no longer hides the file's.
export function without_setting(edits: SettingEdits, name: keyof Settings): SettingEdits {
  const { [name]: _saved, ...saved } = edits.saved;
  const { [name]: _temp, ...temp } = edits.temp;
  return { saved, temp };
}

// Stored while the browser copy of settings.toml is ahead of the folder. `base` is the folder's text the first unwritten edit started from (null: no file), so the host can tell a hand edit since.
export type UnsyncedSettingsFile = { base: string | null };

export async function read_unsynced(): Promise<UnsyncedSettingsFile | undefined> {
  const stored = (await browser.storage.local.get(SETTINGS_FILE_UNSYNCED_STORAGE_KEY))[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] as { base?: unknown } | undefined;
  if (stored === undefined || !(typeof stored.base === "string" || stored.base === null)) return undefined;
  return { base: stored.base };
}

export async function store_unsynced(record: UnsyncedSettingsFile): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_FILE_UNSYNCED_STORAGE_KEY]: record });
}

export async function clear_unsynced(): Promise<void> {
  await browser.storage.local.remove(SETTINGS_FILE_UNSYNCED_STORAGE_KEY);
}

export async function text_sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// What became of the file after the browser copy changed.
// `waiting`: no host, no permission or a host without `write_settings`, so the next start or `,r` writes it.
// `conflict`: the file changed on disk, so the copies-differ question took over. `failed`: the host could not write, and the next start tries again.
// `saved_in_browser`: an imported theme, which the files cannot name, went to the saved edits instead.
export type FileWriteOutcome = { kind: "written" } | { kind: "waiting" } | { kind: "conflict" } | { kind: "failed"; reason: string } | { kind: "saved_in_browser" };

export function outcome_note(outcome: FileWriteOutcome): string {
  switch (outcome.kind) {
    case "written": return `, saved to ${SETTINGS_FILE}`;
    case "waiting": return `. ${SETTINGS_FILE} updates when the native host connects`;
    case "conflict": return `. ${SETTINGS_FILE} changed on disk, so it stays as it is. Open the Settings page to choose`;
    case "failed": return `. ${SETTINGS_FILE} was not written (${outcome.reason}). It is tried again at the next start`;
    case "saved_in_browser": return ", saved in the browser because the theme is not in your files";
  }
}
