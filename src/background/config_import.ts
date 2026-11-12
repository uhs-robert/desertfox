// The pure part of a config import: the user's zip or folder to the raw files to apply, and the preview the settings page shows first.
// No snippet runs here. A snippet file is only read as text, and its header parsed, until the user accepts it by its exact code.

import { parse, stringify } from "smol-toml";
import type { CommandMeta } from "../shared/command.ts";
import { build_config } from "../shared/config_build/build_config.ts";
import { ConfigErrors } from "../shared/config_build/errors.ts";
import { parse_snippet } from "../shared/config_build/snippet.ts";
import { AUTOCONFIG_FILE, KNOWN_TOP_LEVEL, type ConfigFiles } from "../shared/config_build/source_files.ts";
import type { CommitConfigImport, ConfigImportAnswer, ConfigImportPreview, ImportSource, PreviewConfigImport, SnippetPreview } from "../shared/messages.ts";
import { read_folder, read_zip, ZipError } from "../shared/zip.ts";
import { ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";

const SNIPPETS_PREFIX = "snippets/";
// Problem messages and origins of an import name this folder instead of the host's config folder.
export const IMPORT_DIR_LABEL = "import";

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

// Every import path goes through the zip guards: paths, junk, duplicates, entry count and sizes.
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
  return Object.fromEntries(files);
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

// Each of these is a consent the user gives on this machine, so a file from elsewhere must not switch it on.
const CONSENT_SETTINGS = ["bridge", "bridge_share_tabs", "host_auto_update"] as const;
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

function preview_snippet(path: string, code: string, current: ConfigFiles): SnippetPreview {
  const problems: string[] = [];
  const entry = parse_snippet(`${IMPORT_DIR_LABEL}/${path}`, code, problems);
  return {
    path,
    code,
    replaces: Object.hasOwn(current, path),
    problems,
    ...(entry && { id: entry.id, label: entry.label, intent: entry.intent, matches: entry.matches, requires: entry.requires ?? [] }),
  };
}

// The build runs with every snippet accepted, so a problem shows before the user decides. Declining a snippet a key binds makes the commit refuse.
export function preview_import(incoming: ConfigFiles, current: ConfigFiles, commands: CommandMeta[]): ConfigImportPreview {
  const imported = split_files(incoming);
  const { files, replaces_config, dropped } = plan_import_files(incoming, current, imported.snippet_files);
  const warnings: string[] = [...dropped];
  let problems: string[] = [];
  try {
    build_config(files, commands, warnings, { dir_label: IMPORT_DIR_LABEL });
  } catch (error) {
    if (!(error instanceof ConfigErrors)) throw error;
    problems = error.problems;
  }
  return {
    ok: true,
    replaces_config,
    config_files: Object.keys(imported.config_files).sort(),
    snippets: Object.entries(imported.snippet_files).map(([path, code]) => preview_snippet(path, code, current)),
    problems,
    warnings,
  };
}

export type ConfigImportDeps = {
  preview: (source: unknown) => Promise<ConfigImportPreview>;
  commit: (source: unknown, accepted: unknown) => Promise<{ warnings: number; replaces_config: boolean; snippets: number }>;
};

// The settings page's two import messages. Every failure becomes the answer's message, and a refusal already says what stays.
export async function answer_config_import(request: PreviewConfigImport | CommitConfigImport, deps: ConfigImportDeps): Promise<ConfigImportPreview | ConfigImportAnswer> {
  try {
    if (request.type === "preview_config_import") return await deps.preview(request.source);
    const { warnings, replaces_config, snippets } = await deps.commit(request.source, request.accepted);
    const parts = [...(replaces_config ? ["the config files"] : []), ...(snippets > 0 ? [`${snippets} snippet(s)`] : [])];
    const warned = warnings === 0 ? "" : `, with ${warnings} warning(s) on the Help page`;
    return { ok: true, message: `Imported ${parts.join(" and ")}${warned}` };
  } catch (error) {
    if (error instanceof ConfigRefusal) return { ok: false, message: error.message };
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${KEPT_CURRENT.import.replace(/\.$/, "")}: ${reason}` };
  }
}
