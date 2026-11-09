// The settings page's export, snippet list and snippet removal. The page builds the zips itself, so this answers with raw files.

import { stringify } from "smol-toml";
import type { SettingOverrides } from "../shared/config.ts";
import { parse_snippet } from "../shared/config_build/snippet.ts";
import { AUTOCONFIG_FILE, type ConfigFiles } from "../shared/config_build/source_files.ts";
import type { ConfigImportAnswer, ExportConfig, ExportConfigAnswer, InstalledSnippet, ListSnippets, ListSnippetsAnswer, RemoveSnippet } from "../shared/messages.ts";
import { ConfigRefusal } from "./config_reload.ts";

const SNIPPETS_PREFIX = "snippets/";
const SAVED_EDITS_FILE = "settings.toml";
// Sorts after any other file of `settings.d`, so the saved edits win over it, as they do in the browser.
const SAVED_EDITS_FALLBACK_FILE = "settings.d/zz-saved-edits.toml";

const is_snippet_path = (path: string) => path.startsWith(SNIPPETS_PREFIX);

// The saved edits go in `settings.toml`. A config that already has one keeps it, and the edits go in a later file of `settings.d`.
export function export_files(files: ConfigFiles, saved: SettingOverrides): { config_files: ConfigFiles; snippet_files: ConfigFiles } {
  const entries = Object.entries(files).filter(([path]) => path !== AUTOCONFIG_FILE);
  const config_files: ConfigFiles = Object.fromEntries(entries.filter(([path]) => !is_snippet_path(path)));
  if (Object.keys(saved).length > 0) config_files[Object.hasOwn(config_files, SAVED_EDITS_FILE) ? SAVED_EDITS_FALLBACK_FILE : SAVED_EDITS_FILE] = stringify(saved);
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
  remove: (path: string) => Promise<{ warnings: number }>;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function answer_config_transfer(request: ExportConfig | ListSnippets | RemoveSnippet, deps: ConfigTransferDeps): Promise<ExportConfigAnswer | ListSnippetsAnswer | ConfigImportAnswer> {
  try {
    if (request.type === "list_snippets") return { ok: true, snippets: installed_snippets(await deps.read_files()) };
    if (request.type === "export_config") return { ok: true, ...export_files(await deps.read_files(), await deps.read_saved()) };
    if (typeof request.path !== "string") return { ok: false, message: "The removal names no snippet." };
    const { warnings } = await deps.remove(request.path);
    return { ok: true, message: `Removed ${request.path}${warnings === 0 ? "" : `, with ${warnings} warning(s) on the Help page`}` };
  } catch (error) {
    return { ok: false, message: error instanceof ConfigRefusal ? error.message : message_of(error) };
  }
}
