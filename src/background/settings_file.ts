// A setting written into, or removed from, settings.toml: the edit of the browser copy, and the record of a copy the folder has not caught up with.
// `startup.ts` runs both in the change queue and sends the text to the native host (`write_settings`).

import { parse, TomlError } from "smol-toml";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { SettingEdits, Settings } from "../shared/config.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { remove_top_level_key, same_value, set_top_level_key } from "./toml_key_edit.ts";
import type { TomlValue } from "./toml_key_edit.ts";
import { SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "./storage_keys.ts";

export const SETTINGS_FILE = "settings.toml";

// The `settings.d` file that sets `name`, if any. It loads after settings.toml, so its value hides the one there.
export function settings_d_file_that_sets(files: ConfigFiles, name: keyof Settings): string | undefined {
  return Object.keys(files).find((path) => path.startsWith("settings.d/") && path.endsWith(".toml") && Object.hasOwn(parse(files[path]!), name));
}

export const held_in_settings_d = (path: string, name: keyof Settings) => new RuntimeRefusal(`${path} sets ${name}, and it wins over ${SETTINGS_FILE}. Change it there.`);

export function with_setting_in_files(files: ConfigFiles, name: keyof Settings, value: TomlValue): ConfigFiles {
  const winning_file = settings_d_file_that_sets(files, name);
  if (winning_file !== undefined) throw held_in_settings_d(winning_file, name);
  return { ...files, [SETTINGS_FILE]: set_top_level_key(files[SETTINGS_FILE] ?? "", name, value, SETTINGS_FILE) };
}

export function without_setting_in_files(files: ConfigFiles, name: keyof Settings): ConfigFiles {
  return { ...files, [SETTINGS_FILE]: remove_top_level_key(files[SETTINGS_FILE] ?? "", name, SETTINGS_FILE) };
}

// Whether settings.toml itself sets `name`, as opposed to a default or a `settings.d` file.
export function settings_file_sets(files: ConfigFiles, name: keyof Settings): boolean {
  return Object.hasOwn(parse(files[SETTINGS_FILE] ?? ""), name);
}

// The edits without `name`, so a saved or temp value no longer hides the file's.
export function without_setting(edits: SettingEdits, name: keyof Settings): SettingEdits {
  const { [name]: _saved, ...saved } = edits.saved;
  const { [name]: _temp, ...temp } = edits.temp;
  return { saved, temp };
}

// Stored while the browser copy of settings.toml is ahead of the folder. `base` is the folder's text the first unwritten edit started from (null: no file), so the host can tell a hand edit since.
export type UnsyncedSettingsFile = { base: string | null };

// The keys the browser copy changed over `base`, set the same way on `folder`, the folder's new text (null: no file).
// The record needs no list of its edits: while it stands, the copy's settings.toml is `base` plus those edits, so a parse of both gives them back.
// Undefined when that is not safe: the folder changed one of those keys too, removed a file the base had, or holds a value the editor does not write (a table, a list of anything but strings).
export function replayed_on_folder(base: string | null, edited: string, folder: string | null): string | undefined {
  if (base !== null && folder === null) return undefined;
  try {
    const before = parse(base ?? "") as Record<string, unknown>;
    const after = parse(edited) as Record<string, unknown>;
    const on_folder = parse(folder ?? "") as Record<string, unknown>;
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !same_value(before[key], after[key]));
    if (changed.length === 0 || changed.some((key) => !same_value(on_folder[key], before[key]))) return undefined;
    let text = folder ?? "";
    for (const key of changed) {
      const value = after[key];
      if (value === undefined) text = remove_top_level_key(text, key, SETTINGS_FILE);
      else if (is_toml_value(value)) text = set_top_level_key(text, key, value, SETTINGS_FILE);
      else return undefined;
    }
    return text;
  } catch (error) {
    if (error instanceof TomlError || error instanceof RuntimeRefusal) return undefined;
    throw error;
  }
}

const is_toml_value = (value: unknown): value is TomlValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && value.every((item) => typeof item === "string"));

export async function read_unsynced(): Promise<UnsyncedSettingsFile | undefined> {
  // `null` is a dropped record: `apply_files` drops it inside its one storage write.
  const stored = (await browser.storage.local.get(SETTINGS_FILE_UNSYNCED_STORAGE_KEY))[SETTINGS_FILE_UNSYNCED_STORAGE_KEY] as { base?: unknown } | null | undefined;
  if (typeof stored !== "object" || stored === null || !(typeof stored.base === "string" || stored.base === null)) return undefined;
  return { base: stored.base };
}

export async function store_unsynced(unsynced: UnsyncedSettingsFile): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_FILE_UNSYNCED_STORAGE_KEY]: unsynced });
}

export async function clear_unsynced(): Promise<void> {
  await browser.storage.local.remove(SETTINGS_FILE_UNSYNCED_STORAGE_KEY);
}

export async function text_sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// What became of the file after a setting changed in the browser copy.
// `waiting`: no host, no permission or a host without `write_settings` (`host_outdated`), so the next start or `,r` writes it.
// `conflict`: the file changed on disk, so the copies-differ question took over. `conflict_kept`: it changed on disk, and no question was stored (the user kept the browser copy over that folder before), so the change stays in the browser copy only.
// `failed`: the host could not write, or the folder could not be read after a refusal, and the next start tries again.
// `replaced`: a swap replaced the browser copy after the change and dropped the record. `written` says whether the folder got the change before that.
// `saved_in_browser`: a theme or search engine known only in the browser, which the files cannot name, went to the saved edits instead.
// `browser_copy`: the browser copy did not come from the config folder, so only the copy changed.
export type FileWriteOutcome = { kind: "written" } | { kind: "waiting"; host_outdated?: true } | { kind: "conflict" } | { kind: "conflict_kept" } | { kind: "failed"; reason: string } | { kind: "saved_in_browser"; missing: NamedKind } | { kind: "browser_copy" } | { kind: "replaced"; by: CopyReplacedBy; written: boolean };

// What a setting value can name that the files build checks.
export type NamedKind = "theme" | "search engine";

// The swaps that drop the record: a read of the config folder (`,r`, Use the folder), an import of config files and an editor save of settings.toml.
export type CopyReplacedBy = "reload" | "import" | "edit";
const REPLACED_BY: Record<CopyReplacedBy, string> = { reload: "A read of the config folder", import: "A config import", edit: `An editor save of ${SETTINGS_FILE}` };

export function outcome_note(outcome: FileWriteOutcome): string {
  switch (outcome.kind) {
    case "written": return `, saved to ${SETTINGS_FILE}`;
    case "waiting": return outcome.host_outdated ? `. ${SETTINGS_FILE} updates once the native host is updated` : `. ${SETTINGS_FILE} updates when the native host connects`;
    case "conflict": return `. ${SETTINGS_FILE} changed on disk, so it stays as it is. Open the Settings page to choose`;
    case "failed": return `. ${SETTINGS_FILE} was not written (${outcome.reason}). It is tried again at the next start`;
    case "conflict_kept": return `. ${SETTINGS_FILE} changed on disk, so it stays as it is, and the change stays in the browser copy`;
    case "saved_in_browser": return `, saved in the browser because the ${outcome.missing} is not in your files`;
    case "browser_copy": return `, saved in the browser copy. It did not come from a config folder, so no ${SETTINGS_FILE} is written`;
    case "replaced": return outcome.written ? `, saved to ${SETTINGS_FILE}. ${REPLACED_BY[outcome.by]} replaced the browser copy during the write` : `. ${REPLACED_BY[outcome.by]} replaced the browser copy before the write, so ${SETTINGS_FILE} was not written`;
  }
}
