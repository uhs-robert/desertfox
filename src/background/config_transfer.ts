// The settings page's export, snippet list and snippet removal. The page builds the zips itself, so this answers with raw files.

import { stringify } from "smol-toml";
import type { SettingOverrides } from "../shared/config.ts";
import { parse_snippet } from "../shared/config_build/snippet.ts";
import { AUTOCONFIG_FILE, type ConfigFiles } from "../shared/config_build/source_files.ts";
import type { ConfigImportAnswer, ExportConfig, ExportConfigAnswer, InstalledSnippet, ListSnippets, ListSnippetsAnswer, RemoveSnippet } from "../shared/messages.ts";
import { ConfigRefusal } from "./config_reload.ts";
import type { AliasEdits, EngineEdits, KeymapEdits } from "./edit_layers.ts";
import type { QuickmarkTable } from "../shared/quickmark_names.ts";

const SNIPPETS_PREFIX = "snippets/";
const SAVED_EDITS_FILE = "settings.toml";
const SETTINGS_DIR = "settings.d/";
const KEYMAP_DIR = "keymap.d/";
const ENGINES_DIR = "search_engines.d/";
const ALIASES_DIR = "command_aliases.d/";
const QUICKMARKS_DIR = "quickmarks.d/";
const SAVED_EDITS_NAME = "zz-saved-edits.toml";

const is_snippet_path = (path: string) => path.startsWith(SNIPPETS_PREFIX);

// A later file of a `.d` folder wins, as the browser edits do. So the edits go in a file that sorts after every file in `dir` and overwrites none.
function last_path_in(dir: string, config_files: ConfigFiles): string {
  const last = Object.keys(config_files)
    .filter((path) => path.startsWith(dir))
    .map((path) => path.slice(dir.length))
    .reduce((a, b) => (a > b ? a : b), "");
  // Past the last name, the new name is longer than it and so sorts after it, and after every other name.
  return `${dir}${last < SAVED_EDITS_NAME ? SAVED_EDITS_NAME : `${last}-${SAVED_EDITS_NAME}`}`;
}

// A config with no settings file at all gets the saved settings as `settings.toml`.
function saved_edits_path(config_files: ConfigFiles): string {
  const has_settings = Object.hasOwn(config_files, SAVED_EDITS_FILE) || Object.keys(config_files).some((path) => path.startsWith(SETTINGS_DIR));
  return has_settings ? last_path_in(SETTINGS_DIR, config_files) : SAVED_EDITS_FILE;
}

// The files the key, engine, alias and quickmark edits add to `files`. Each goes in a file that sorts after every file of its folder.
// The key edits already have keymap.d's form: a table per mode, with "" to unbind. The key letters of the engines join them as `[search_keys]`, one file for keymap.d.
// The engine build reads these same files, so an engine in force is the engine an import of the export gives.
// The quickmarks are the `M` store's normal-window layer, which the store lays over the config table the same way.
export function layer_files(files: ConfigFiles, keymap_edits: KeymapEdits, engine_edits: EngineEdits, alias_edits: AliasEdits = {}, quickmarks: QuickmarkTable = {}): ConfigFiles {
  const added: ConfigFiles = {};
  const keymap_table = { ...keymap_edits, ...(Object.keys(engine_edits.letters ?? {}).length > 0 && { search_keys: engine_edits.letters }) };
  if (Object.keys(keymap_table).length > 0) added[last_path_in(KEYMAP_DIR, files)] = stringify(keymap_table);
  if (Object.keys(engine_edits.engines ?? {}).length > 0) added[last_path_in(ENGINES_DIR, files)] = stringify(engine_edits.engines!);
  if (Object.keys(alias_edits).length > 0) added[last_path_in(ALIASES_DIR, files)] = stringify(alias_edits);
  if (Object.keys(quickmarks).length > 0) added[last_path_in(QUICKMARKS_DIR, files)] = stringify(quickmarks);
  return added;
}

export function export_files(files: ConfigFiles, saved: SettingOverrides, keymap_edits: KeymapEdits = {}, engine_edits: EngineEdits = {}, alias_edits: AliasEdits = {}, quickmarks: QuickmarkTable = {}): { config_files: ConfigFiles; snippet_files: ConfigFiles } {
  const entries = Object.entries(files).filter(([path]) => path !== AUTOCONFIG_FILE);
  const config_files: ConfigFiles = Object.fromEntries(entries.filter(([path]) => !is_snippet_path(path)));
  if (Object.keys(saved).length > 0) config_files[saved_edits_path(config_files)] = stringify(saved);
  Object.assign(config_files, layer_files(config_files, keymap_edits, engine_edits, alias_edits, quickmarks));
  return { config_files, snippet_files: Object.fromEntries(entries.filter(([path]) => is_snippet_path(path))) };
}

export function installed_snippets(files: ConfigFiles): InstalledSnippet[] {
  return Object.keys(files)
    .filter(is_snippet_path)
    .sort()
    .map((path) => {
      const problems: string[] = [];
      const entry = parse_snippet(path, files[path]!, problems);
      return { path, problems, ...(entry && { id: entry.id, label: entry.label, intent: entry.intent, matches: entry.matches, requires: entry.requires ?? [] }) };
    });
}

export type ConfigTransferDeps = {
  read_files: () => Promise<ConfigFiles>;
  read_saved: () => Promise<SettingOverrides>;
  // Only the edits that read. `skipped` names the rest.
  read_keymap_edits: () => Promise<{ edits: KeymapEdits; skipped: string[] }>;
  // Only the engines and aliases the build keeps. `skipped` names the rest.
  read_engine_edits?: () => Promise<{ edits: EngineEdits; aliases: AliasEdits; skipped: string[] }>;
  // The quickmarks saved in a normal window.
  read_quickmarks?: () => Promise<QuickmarkTable>;
  remove: (path: string) => Promise<{ warnings: number }>;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function answer_config_transfer(request: ExportConfig | ListSnippets | RemoveSnippet, deps: ConfigTransferDeps): Promise<ExportConfigAnswer | ListSnippetsAnswer | ConfigImportAnswer> {
  try {
    if (request.type === "list_snippets") return { ok: true, snippets: installed_snippets(await deps.read_files()) };
    if (request.type === "export_config") {
      const { edits, skipped } = await deps.read_keymap_edits();
      const engines = (await deps.read_engine_edits?.()) ?? { edits: {}, aliases: {}, skipped: [] };
      return {
        ok: true,
        ...export_files(await deps.read_files(), await deps.read_saved(), edits, engines.edits, engines.aliases, (await deps.read_quickmarks?.()) ?? {}),
        ...(skipped.length > 0 && { skipped_key_edits: skipped }),
        ...(engines.skipped.length > 0 && { skipped_engine_edits: engines.skipped }),
      };
    }
    if (typeof request.path !== "string") return { ok: false, message: "The removal names no snippet." };
    const { warnings } = await deps.remove(request.path);
    return { ok: true, message: `Removed ${request.path}${warnings === 0 ? "" : `, with ${warnings} warning(s) on the Help page`}. A config.reload brings it back while the file stays in the config folder.` };
  } catch (error) {
    return { ok: false, message: error instanceof ConfigRefusal ? error.message : message_of(error) };
  }
}
