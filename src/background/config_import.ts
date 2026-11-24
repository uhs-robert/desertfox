// The pure part of a config import: the user's zip or folder to the raw files to apply, and the preview the settings page shows first.
// No snippet runs here. A snippet file is only read as text, and its header parsed, until the user accepts it by its exact code.

import { parse, stringify } from "smol-toml";
import type { CommandMeta } from "../shared/command.ts";
import { build_config } from "../shared/config_build/build_config.ts";
import { ConfigErrors } from "../shared/config_build/errors.ts";
import { parse_snippet } from "../shared/config_build/snippet.ts";
import { AUTOCONFIG_FILE, KNOWN_TOP_LEVEL, labeled_path, type ConfigFiles } from "../shared/config_build/source_files.ts";
import type { CommitConfigImport, ConfigImportAnswer, ConfigImportPreview, ImportSource, PreviewConfigImport, SnippetPreview } from "../shared/messages/page.ts";
import { read_folder, read_zip, ZipError } from "../shared/zip.ts";
import { css_limit_breaches } from "./css_limits.ts";
import { ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";
import { IMPORT_DIR_LABEL } from "../shared/config/config_load.ts";
import { import_reach, no_reach } from "./import_reach.ts";
import { CONSENT_SETTINGS } from "../shared/settings_schema.ts";
import { host_file_of } from "./native_client.ts";
import { outcome_note, SETTINGS_FILE, with_setting_in_files } from "./settings_file.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { TomlValue } from "./toml_key_edit.ts";
import type { FileWriteOutcome, UnsyncedFiles } from "./settings_file.ts";

const SNIPPETS_PREFIX = "snippets/";
export { IMPORT_DIR_LABEL };

const refuse = (reason: string) => new ConfigRefusal(`${KEPT_CURRENT.import} ${reason}`);

// A zip of the desertfox folder and a `webkitdirectory` pick both put every file under one folder name. A config file at the top, or a top folder the config knows (`snippets/`), means the files already start at the config root.
export function strip_top_folder(files: Map<string, string>): Map<string, string> {
  const tops = new Set([...files.keys()].map((path) => (path.includes("/") ? path.split("/")[0]! : "")));
  const [top] = tops;
  if (tops.size !== 1 || top === undefined || top === "" || KNOWN_TOP_LEVEL.has(top)) return files;
  return new Map([...files].map(([path, text]) => [path.slice(top.length + 1), text]));
}

function is_import_source(source: unknown): source is ImportSource {
  if (typeof source !== "object" || source === null) return false;
  const candidate = source as Record<string, unknown>;
  if (candidate.kind === "zip") return candidate.bytes instanceof Uint8Array || candidate.bytes instanceof ArrayBuffer;
  return candidate.kind === "folder" && Array.isArray(candidate.entries);
}

// Every import path goes through the zip guards: paths, junk, duplicates, entry count and sizes, and then the CSS limits.
export async function read_import_source(source: unknown): Promise<ConfigFiles> {
  if (!is_import_source(source)) throw refuse("The import names no zip and no folder.");
  let read: Map<string, string>;
  try {
    read = source.kind === "zip" ? await read_zip(new Uint8Array(source.bytes)) : read_folder(source.entries);
  } catch (error) {
    if (error instanceof ZipError) throw refuse(`The ${source.kind} is refused: ${error.message}.`);
    throw error;
  }
  const files = strip_top_folder(read);
  // Hidden folders are skipped, so a zip made from the home folder (`.config/desertfox/...`) reads as nothing.
  if (files.size === 0) throw refuse(`The ${source.kind} holds no config files. Pick the desertfox config folder itself, or a zip of it.`);
  const read_files = Object.fromEntries(files);
  const [breach] = css_limit_breaches(read_files);
  if (breach) throw refuse(`${breach.file} line ${breach.line} holds ${breach.what}. Imported CSS may not load anything but data: addresses. Remove it from the file and import again.`);
  return read_files;
}

const is_snippet_path = (path: string) => path.startsWith(SNIPPETS_PREFIX);

// `autoconfig.toml` is left out: the build never reads it, so alone it would replace the config with the defaults.
function split_files(files: ConfigFiles): { config_files: ConfigFiles; snippet_files: ConfigFiles } {
  const entries = Object.entries(files).filter(([path]) => path !== AUTOCONFIG_FILE);
  return {
    config_files: Object.fromEntries(entries.filter(([path]) => !is_snippet_path(path))),
    snippet_files: Object.fromEntries(entries.filter(([path]) => is_snippet_path(path))),
  };
}

const is_settings_file = (path: string) => path === "settings.toml" || (path.startsWith("settings.d/") && path.endsWith(".toml"));

// A settings file that holds a consent key is rewritten without it, which drops its comments. One that does not parse stays as it is, and the build reports it.
export function drop_consent_settings(files: ConfigFiles): { files: ConfigFiles; dropped: string[] } {
  const kept: ConfigFiles = {};
  const dropped: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    kept[path] = text;
    if (!is_settings_file(path)) continue;
    let data: Record<string, unknown>;
    try {
      data = parse(text);
    } catch {
      continue;
    }
    const found = CONSENT_SETTINGS.filter((key) => Object.hasOwn(data, key));
    if (found.length === 0) continue;
    for (const key of found) delete data[key];
    kept[path] = stringify(data);
    dropped.push(...found.map((key) => `${path}: ${key} is not imported. Set it on this machine.`));
  }
  return { files: kept, dropped };
}

// The files an import leaves in the slot. Config files in the import replace every config file in the slot. Without any, the slot's stay.
// The slot's snippets always stay, and an accepted snippet joins them, in place of one at the same path.
export function plan_import_files(incoming: ConfigFiles, current: ConfigFiles, accepted: Record<string, string>): { files: ConfigFiles; replaces_config: boolean; dropped: string[] } {
  const imported = split_files(incoming);
  const kept = split_files(current);
  const replaces_config = Object.keys(imported.config_files).length > 0;
  const { files: config_files, dropped } = replaces_config ? drop_consent_settings(imported.config_files) : { files: kept.config_files, dropped: [] };
  return { files: { ...config_files, ...kept.snippet_files, ...accepted }, replaces_config, dropped };
}

// What an import of config files sends to the folder: the copy's files, and the record that sends them (path to the folder's text).
// `settings_kept_for_consent`: the folder's settings.toml sets a consent key the import's text could not take, so that file stays out of the record.
export type FolderWritePlan = { files: ConfigFiles; record: UnsyncedFiles; settings_kept_for_consent: boolean };

// The record holds each file the host writes that the import holds at another text. A file the import lacks stays as the folder has it. Snippets are code, which the host never writes.
// A path in `paths_out` has a write still out, which can land after this read: it goes in the record even at the folder's text, so the import's text follows that write.
export function plan_folder_writes(files: ConfigFiles, folder: ConfigFiles, paths_out: ReadonlySet<string> = new Set()): FolderWritePlan {
  const with_consent = with_folder_consent(files, folder);
  const copy = with_consent ?? files;
  const sent = (path: string, text: string) => host_file_of(path) !== undefined && (folder[path] !== text || paths_out.has(path)) && !(path === SETTINGS_FILE && with_consent === undefined);
  const record = Object.fromEntries(Object.entries(copy).filter(([path, text]) => sent(path, text)).map(([path]) => [path, folder[path] ?? null]));
  return { files: copy, record, settings_kept_for_consent: with_consent === undefined };
}

// The import's settings.toml with the consent keys the folder's settings.toml sets, so a write of it to the folder keeps the consent given on this machine. The import's own consent keys are already gone (`drop_consent_settings`).
// Undefined when a folder file that does not parse or a key the editor cannot set leaves that consent unknown or lost.
function with_folder_consent(files: ConfigFiles, folder: ConfigFiles): ConfigFiles | undefined {
  if (files[SETTINGS_FILE] === undefined) return files;
  let folder_settings: Record<string, unknown>;
  try {
    folder_settings = parse(folder[SETTINGS_FILE] ?? "");
  } catch {
    return undefined;
  }
  let kept = files;
  for (const key of CONSENT_SETTINGS) {
    if (!Object.hasOwn(folder_settings, key)) continue;
    try {
      kept = with_setting_in_files(kept, key, folder_settings[key] as TomlValue);
    } catch (error) {
      if (!(error instanceof RuntimeRefusal)) throw error;
      return undefined;
    }
  }
  return kept;
}

const CONSENT_KEPT_NOTE = `${SETTINGS_FILE} is not written to the config folder: it sets consent settings the imported file could not take, so it stays as it is, and a reload (,r) takes its settings back`;

// Consent is to the exact code the preview showed, so the commit takes the code back and stores only an exact match.
export function checked_consent(incoming: ConfigFiles, accepted: unknown): Record<string, string> {
  if (typeof accepted !== "object" || accepted === null || Array.isArray(accepted)) throw refuse("The accepted snippets are not a list of paths and code.");
  const checked: Record<string, string> = {};
  for (const [path, code] of Object.entries(accepted)) {
    if (!is_snippet_path(path) || !Object.hasOwn(incoming, path)) throw refuse(`The import holds no snippet ${path}.`);
    if (code !== incoming[path]) throw refuse(`The snippet ${path} differs from the one accepted. Preview the import again.`);
    checked[path] = code;
  }
  return checked;
}

export function imports_nothing(incoming: ConfigFiles, accepted: Record<string, string>): boolean {
  return Object.keys(split_files(incoming).config_files).length === 0 && Object.keys(accepted).length === 0;
}

export function preview_snippet(path: string, code: string, current: ConfigFiles, dir_label: string = IMPORT_DIR_LABEL): SnippetPreview {
  const problems: string[] = [];
  const entry = parse_snippet(labeled_path(dir_label, path), code, problems);
  return {
    path,
    code,
    replaces: Object.hasOwn(current, path),
    problems,
    ...(entry && { id: entry.id, label: entry.label, intent: entry.intent, matches: entry.matches, requires: entry.requires ?? [] }),
  };
}

// The build runs with every snippet accepted, so a problem shows before the user decides. Declining a snippet a key binds makes the commit refuse.
// `folder` is the config folder's files when the host could read them, so the review names the files the import writes there.
export function preview_import(incoming: ConfigFiles, current: ConfigFiles, commands: CommandMeta[], folder?: ConfigFiles): ConfigImportPreview {
  const imported = split_files(incoming);
  const { files, replaces_config, dropped } = plan_import_files(incoming, current, imported.snippet_files);
  const folder_plan = replaces_config && folder ? plan_folder_writes(files, folder) : undefined;
  const warnings: string[] = [...dropped, ...(folder_plan?.settings_kept_for_consent ? [`${CONSENT_KEPT_NOTE}.`] : [])];
  let problems: string[] = [];
  let reach = no_reach();
  try {
    reach = import_reach(build_config(files, commands, warnings, { dir_label: IMPORT_DIR_LABEL }), commands);
  } catch (error) {
    if (!(error instanceof ConfigErrors)) throw error;
    problems = error.problems;
  }
  return {
    ok: true,
    replaces_config,
    config_files: Object.keys(imported.config_files).sort(),
    folder_files: Object.keys(folder_plan?.record ?? {}).sort(),
    snippets: Object.entries(imported.snippet_files).map(([path, code]) => preview_snippet(path, code, current)),
    problems,
    warnings,
    reach,
  };
}

// What became of each file an import of config files sent to the folder. Absent when the folder could not be read, so the import stayed in the browser.
export type FolderWrite = { path: string; outcome: FileWriteOutcome };
export type ImportResult = { warnings: number; replaces_config: boolean; snippets: number; folder_writes?: FolderWrite[]; settings_kept_for_consent?: boolean };

export type ConfigImportDeps = {
  preview: (source: unknown) => Promise<ConfigImportPreview>;
  commit: (source: unknown, accepted: unknown) => Promise<ImportResult>;
};

// The end of the answer about the config folder. Only an import of config files has one.
function folder_note({ replaces_config, folder_writes, settings_kept_for_consent }: ImportResult): string {
  if (!replaces_config) return "";
  if (!folder_writes) return ". The config folder was not updated";
  const written = folder_writes.filter(({ outcome }) => outcome.kind === "written").map(({ path }) => path);
  const wrote = written.length === 0 ? "" : `. Wrote ${written.join(", ")} to the config folder`;
  const consent = settings_kept_for_consent ? `. ${CONSENT_KEPT_NOTE}` : "";
  return wrote + folder_writes.map(({ path, outcome }) => (outcome.kind === "written" ? "" : outcome_note(outcome, path))).join("") + consent;
}

// The settings page's two import messages. Every failure becomes the answer's message, and a refusal already says what stays.
export function answer_config_import(request: PreviewConfigImport, deps: ConfigImportDeps): Promise<ConfigImportPreview>;
export function answer_config_import(request: CommitConfigImport, deps: ConfigImportDeps): Promise<ConfigImportAnswer>;
export async function answer_config_import(request: PreviewConfigImport | CommitConfigImport, deps: ConfigImportDeps): Promise<ConfigImportPreview | ConfigImportAnswer> {
  try {
    if (request.type === "preview_config_import") return await deps.preview(request.source);
    const result = await deps.commit(request.source, request.accepted);
    const { warnings, replaces_config, snippets } = result;
    const parts = [...(replaces_config ? ["the config files"] : []), ...(snippets > 0 ? [`${snippets} snippet(s)`] : [])];
    const warned = warnings === 0 ? "" : `, with ${warnings} warning(s) on the Help page`;
    return { ok: true, message: `Imported ${parts.join(" and ")}${warned}${folder_note(result)}` };
  } catch (error) {
    if (error instanceof ConfigRefusal) return { ok: false, message: error.message };
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${KEPT_CURRENT.import.replace(/\.$/, "")}: ${reason}` };
  }
}
