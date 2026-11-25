// A setting written into, or removed from, settings.toml: the edit of the browser copy, and the record of the files the folder has not caught up with.
// `config_setting_writes.ts` runs both in the change queue and `config_file_writes.ts` sends the files' texts to the native host in one batch (`write_config_files`).

import { parse, TomlError } from "smol-toml";
import { site_rule_rows } from "../shared/config_build/merge.ts";
import { parse_data_layers } from "../shared/config_build/source_files.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";
import type { SettingEdits, Settings } from "../shared/config.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { ToastKind } from "../shared/messages/tab.ts";
import type { Toast } from "../shared/settings_plan.ts";
import { SETTINGS_TABLE } from "../shared/settings_table.ts";
import { parsed, remove_top_level_key, same_value, set_top_level_key } from "./toml_key_edit.ts";
import type { TomlValue } from "./toml_key_edit.ts";
import { remove_table_rows, set_table_rows } from "./toml_table_edit.ts";
import type { TomlRow } from "./toml_table_edit.ts";
import { SETTINGS_FILE_UNSYNCED_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { host_file_of } from "./native_client.ts";

export const SETTINGS_FILE = "settings.toml";

// The `settings.d` file that sets `name`, if any. It loads after settings.toml, so its value hides the one there.
export function settings_d_file_that_sets(files: ConfigFiles, name: keyof Settings): string | undefined {
  return Object.keys(files).find((path) => path.startsWith("settings.d/") && path.endsWith(".toml") && Object.hasOwn(parse(files[path]!), name));
}

// The `settings.d` file that hides settings.toml's value of `name`. `site_rules` is never hidden: its files add up, settings.toml first.
export const settings_d_file_that_hides = (files: ConfigFiles, name: keyof Settings): string | undefined => (name === "site_rules" ? undefined : settings_d_file_that_sets(files, name));

// The `site_rules` rows of the `settings.d` files in the order the build joins them, each with its file. A file that does not parse adds none, as the build refuses it and says why.
export function settings_d_site_rules(files: ConfigFiles): { file: string; row: SiteRuleRow }[] {
  const d_files = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith("settings.d/")));
  return site_rule_rows(parse_data_layers(d_files, "", "settings", []));
}

// The `settings.d` files that set `name` to `value`.
export function settings_d_files_naming(files: ConfigFiles, name: keyof Settings, value: string): string[] {
  return Object.keys(files).filter((path) => path.startsWith("settings.d/") && path.endsWith(".toml") && parse(files[path]!)[name] === value);
}

export const held_in_settings_d = (path: string, name: keyof Settings) => new RuntimeRefusal(`${path} sets ${name}, and it wins over ${SETTINGS_FILE}. Change it there.`);

export function with_setting_in_files(files: ConfigFiles, name: keyof Settings, value: TomlValue): ConfigFiles {
  const winning_file = settings_d_file_that_hides(files, name);
  if (winning_file !== undefined) throw held_in_settings_d(winning_file, name);
  return { ...files, [SETTINGS_FILE]: with_key(files[SETTINGS_FILE] ?? "", name, value) };
}

export function without_setting_in_files(files: ConfigFiles, name: keyof Settings): ConfigFiles {
  return { ...files, [SETTINGS_FILE]: with_key(files[SETTINGS_FILE] ?? "", name, undefined) };
}

// The settings that are lists of tables, which a file holds as `[[name]]` rows.
const is_table_setting = (name: string): boolean => Object.hasOwn(SETTINGS_TABLE, name) && ["table_list", "site_table"].includes(SETTINGS_TABLE[name as keyof typeof SETTINGS_TABLE].kind);

// settings.toml's text with `key` set to `value`, or removed for undefined. A table setting changes only the rows that differ.
function with_key(text: string, key: string, value: TomlValue | undefined): string {
  if (is_table_setting(key)) return value === undefined ? remove_table_rows(text, key, SETTINGS_FILE) : set_table_rows(text, key, value as readonly TomlRow[], SETTINGS_FILE);
  return value === undefined ? remove_top_level_key(text, key, SETTINGS_FILE) : set_top_level_key(text, key, value, SETTINGS_FILE);
}

// The rows of the `[[name]]` list settings.toml itself holds, as written there.
export function rows_in_settings_file(files: ConfigFiles, name: keyof Settings): TomlRow[] {
  const rows = parsed(files[SETTINGS_FILE] ?? "", SETTINGS_FILE)[name];
  return Array.isArray(rows) ? (rows as TomlRow[]) : [];
}

// Whether settings.toml itself sets `name`, as opposed to a default or a `settings.d` file.
export function settings_file_sets(files: ConfigFiles, name: keyof Settings): boolean {
  return Object.hasOwn(parse(files[SETTINGS_FILE] ?? ""), name);
}

// Whether settings.toml itself sets `name` to `value`.
export function settings_file_naming(files: ConfigFiles, name: keyof Settings, value: string): boolean {
  return parse(files[SETTINGS_FILE] ?? "")[name] === value;
}

// The name a settings.toml text sets `name` to, or undefined for none or a text that does not parse.
function name_set_in(text: string | null, name: "theme" | "default_engine"): string | undefined {
  try {
    const value = parse(text ?? "")[name];
    return typeof value === "string" ? value : undefined;
  } catch (error) {
    if (error instanceof TomlError) return undefined;
    throw error;
  }
}

export const theme_named_in = (text: string | null): string | undefined => name_set_in(text, "theme");
export const default_engine_named_in = (text: string | null): string | undefined => name_set_in(text, "default_engine");

// The edits without `name`, so a saved or temp value no longer hides the file's.
export function without_setting(edits: SettingEdits, name: keyof Settings): SettingEdits {
  const { [name]: _saved, ...saved } = edits.saved;
  const { [name]: _temp, ...temp } = edits.temp;
  return { saved, temp };
}

// Stored while the browser copy of a config file the host writes (`host_file_of`) is ahead of the folder, by path.
// Each base is the folder's text the first unwritten edit of that file started from (null: no file), so the host can tell a hand edit since.
export type UnsyncedFiles = Record<string, string | null>;

// The keys the browser copy changed over `base`, set the same way on `folder`, the folder's new text (null: no file).
// The record needs no list of its edits: while it stands, the copy's settings.toml is `base` plus those edits, so a parse of both gives them back.
// Undefined when that is not safe: the folder changed one of those keys too, removed a file the base had, or has a layout the editor refuses.
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
      if (value !== undefined && !is_toml_value(value)) return undefined;
      text = with_key(text, key, value);
    }
    return text;
  } catch (error) {
    if (error instanceof TomlError || error instanceof RuntimeRefusal) return undefined;
    throw error;
  }
}

// A parsed date is the one TOML value the editor does not write.
const is_toml_value = (value: unknown): value is TomlValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) ? value.every(is_toml_value) : typeof value === "object" && value !== null && !(value instanceof Date) && Object.values(value).every(is_toml_value));

// The record as stored, or undefined for none. A record from before theme files were written held settings.toml alone as `{ base }`.
// It reads as that one path, and the next store writes the map, so the old shape is read only until then.
export function unsynced_of_stored(stored: unknown): UnsyncedFiles | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const entries: [string, unknown][] = Object.hasOwn(stored, "base") ? [[SETTINGS_FILE, (stored as { base: unknown }).base]] : Object.entries(stored);
  const kept = entries.filter((entry): entry is [string, string | null] => host_file_of(entry[0]) !== undefined && (typeof entry[1] === "string" || entry[1] === null));
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

// What `apply_files` stores in its one storage write: `null` drops the record.
export const stored_unsynced = (unsynced: UnsyncedFiles | undefined): UnsyncedFiles | null => (unsynced && Object.keys(unsynced).length > 0 ? unsynced : null);

export async function read_unsynced(): Promise<UnsyncedFiles | undefined> {
  return unsynced_of_stored((await browser.storage.local.get(SETTINGS_FILE_UNSYNCED_STORAGE_KEY))[SETTINGS_FILE_UNSYNCED_STORAGE_KEY]);
}

export async function store_unsynced(unsynced: UnsyncedFiles | undefined): Promise<void> {
  const stored = stored_unsynced(unsynced);
  if (stored === null) await browser.storage.local.remove(SETTINGS_FILE_UNSYNCED_STORAGE_KEY);
  else await browser.storage.local.set({ [SETTINGS_FILE_UNSYNCED_STORAGE_KEY]: stored });
}

// The record with `path` added at `base`. A path already in it keeps its base: the folder still holds that text.
export function with_unsynced_path(unsynced: UnsyncedFiles | undefined, path: string, base: string | null): UnsyncedFiles {
  return unsynced && Object.hasOwn(unsynced, path) ? unsynced : { ...unsynced, [path]: base };
}

export function without_unsynced_path(unsynced: UnsyncedFiles | undefined, path: string): UnsyncedFiles | undefined {
  if (!unsynced) return undefined;
  const { [path]: _gone, ...others } = unsynced;
  return stored_unsynced(others) ?? undefined;
}

// The browser copy as it was before the edits the folder never got: every file of the record back at its base text.
export function files_before_unsynced(files: ConfigFiles, unsynced: UnsyncedFiles): ConfigFiles {
  const before = { ...files };
  for (const [path, base] of Object.entries(unsynced)) {
    if (base === null) delete before[path];
    else before[path] = base;
  }
  return before;
}

export async function text_sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// What became of a config file after a change of its browser copy.
// `waiting`: no host, no permission or a host without the write verb (`host_outdated`), so the next start or `,r` writes it.
// `conflict`: the file changed on disk, so the copies-differ question took over. `conflict_kept`: it changed on disk, and no question was stored (the user kept the browser copy over that folder before), so the change stays in the browser copy only.
// `failed`: the host could not write, or the folder could not be read after a refusal, and the next start tries again.
// `replaced`: a swap replaced the browser copy after the change and dropped the record. `written` says whether the folder got the change before that.
// `saved_in_browser`: a search engine known only in the browser, which the files cannot name, went to the saved edits instead.
// `browser_copy`: the browser copy did not come from the config folder, so only the copy changed.
// `held`: the folder would not build after the write (`problem`), or could not be read to check it (`unread`), so the write waits in the record.
export type FileWriteOutcome = { kind: "written" } | { kind: "held"; problem: string; unread?: true } | { kind: "waiting"; host_outdated?: true } | { kind: "conflict" } | { kind: "conflict_kept" } | { kind: "failed"; reason: string } | { kind: "saved_in_browser" } | { kind: "browser_copy" } | { kind: "replaced"; by: CopyReplacedBy; written: boolean };

// The swaps that drop the record: a read of the config folder (`,r`, Use the folder), an import of config files and an editor save of the file itself.
export type CopyReplacedBy = "reload" | "import" | "edit";
const replaced_by = (by: CopyReplacedBy, path: string): string => ({ reload: "A read of the config folder", import: "A config import", edit: `An editor save of ${path}` })[by];

// The end of a reply, about the file at `path`.
export function outcome_note(outcome: FileWriteOutcome, path = SETTINGS_FILE): string {
  switch (outcome.kind) {
    case "written": return `, saved to ${path}`;
    case "waiting": return outcome.host_outdated ? `. ${path} updates once the native host is updated` : `. ${path} updates when the native host connects`;
    case "conflict": return `. ${path} changed on disk, so it stays as it is. Open the Settings page to choose`;
    case "failed": return `. ${path} was not written (${outcome.reason}). It is tried again at the next start`;
    case "held": return outcome.unread ? `. ${path} waits, because the config folder could not be read to check the write (${outcome.problem}). It is tried again at the next start` : `. ${path} waits, because the config folder would not build with it (${outcome.problem}). It is tried again after other writes land and at the next start. When it keeps waiting, change the folder's files by hand, or press ,r to take the folder's files and drop the browser's change`;
    case "conflict_kept": return `. ${path} changed on disk, so it stays as it is, and the change stays in the browser copy`;
    case "saved_in_browser": return ", saved in the browser because the search engine is not in your files";
    case "browser_copy": return `, saved in the browser copy. It did not come from a config folder, so no ${path} is written`;
    case "replaced": return outcome.written ? `, saved to ${path}. ${replaced_by(outcome.by, path)} replaced the browser copy during the write` : `. ${replaced_by(outcome.by, path)} replaced the browser copy before the write, so ${path} was not written`;
  }
}

// A change that left settings.toml as it was, though the setting applies, warns: the file and the browser now differ.
export const outcome_kind = (outcome: FileWriteOutcome): ToastKind =>
  outcome.kind === "failed" || outcome.kind === "held" || outcome.kind === "conflict" || outcome.kind === "conflict_kept" || (outcome.kind === "replaced" && !outcome.written) ? "warning" : "success";

// What an unset did besides a file write: `edits_only` dropped the browser edits and left settings.toml as it was, `not_set` found nothing to drop.
export type UnsetResult = FileWriteOutcome | { kind: "edits_only" } | { kind: "not_set" };

export function unset_toast(name: keyof Settings, result: UnsetResult): Toast {
  if (result.kind === "not_set") return { kind: "info", message: `${name} is not set` };
  if (result.kind === "edits_only") return { kind: "success", message: `Unset ${name}` };
  return { kind: outcome_kind(result), message: `Unset ${name}${outcome_note(result)}` };
}
