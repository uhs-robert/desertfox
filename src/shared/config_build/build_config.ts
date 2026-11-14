// The whole pipeline: parse, merge, parse snippets, parse bindings, check, assemble.
// Pure: it takes raw file text and the command list, so the extension and the build-config tool share it.

import type { CommandMeta } from "../command.ts";
import { CONFIG_FORMAT_VERSION, DEFAULT_THEME, type MergedConfig, type SnippetEntry } from "../config.ts";
import type { Registry } from "../registry/index.ts";
import { build_commands_file } from "../registry/index.ts";
import { built_in_theme_names } from "../theme/load.ts";
import { DESKTOP_THEME, type Theme } from "../theme/roles.ts";
import { build_registry, check_config, resolve_bindings } from "./check.ts";
import { ConfigErrors } from "./errors.ts";
import { merge_layers, origin_key } from "./merge.ts";
import type { MergedData } from "./merge.ts";
import { parse_snippet } from "./snippet.ts";
import { labeled_path, parse_source_files, type ConfigFiles } from "./source_files.ts";
import { parse_theme_files } from "./theme_dir.ts";

// The command list the checks need, cut from the live registry. The build tool reads the same list from `dist/commands.json`.
export function commands_of_registry(registry: Registry): CommandMeta[] {
  return build_commands_file(registry).commands;
}

// Rejects a `theme` setting that names no theme at all.
function check_theme_name(merged: MergedData, local_themes: Record<string, Theme>, built_in_names: readonly string[], problems: string[]): void {
  const name = merged.settings.theme ?? DEFAULT_THEME;
  if (Object.hasOwn(local_themes, name) || name === DESKTOP_THEME || built_in_names.includes(name)) return;
  const file = merged.origins.get(origin_key("settings", "theme")) ?? "config";
  const known = new Set([...Object.keys(local_themes), ...built_in_names]);
  problems.push(`${file}: theme: no theme named "${name}" (known: ${[...known].join(", ")})`);
}

export type BuildOptions = {
  // The config directory as the user knows it. Prefixes the paths in problem messages.
  dir_label?: string;
  built_in_names?: readonly string[];
};

const THEMES_PREFIX = "themes/";

function theme_files_of(files: ConfigFiles): ConfigFiles {
  const themes: ConfigFiles = {};
  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith(THEMES_PREFIX)) themes[path.slice(THEMES_PREFIX.length)] = text;
  }
  return themes;
}

// Warnings are for config that builds but may not mean what it says.
export function build_config(files: ConfigFiles, commands: CommandMeta[], warnings: string[] = [], options: BuildOptions = {}): MergedConfig {
  const { dir_label = "", built_in_names = built_in_theme_names() } = options;
  const problems: string[] = [];
  const sources = parse_source_files(files, dir_label, problems);
  const merged = merge_layers(sources.layers, problems);
  // Every local theme file is checked, so a broken file fails the build.
  const local_themes = parse_theme_files(theme_files_of(files), labeled_path(dir_label, "themes"), problems);
  check_theme_name(merged, local_themes, built_in_names, problems);

  const snippets: SnippetEntry[] = [];
  const snippet_paths: string[] = [];
  for (const { file, text } of sources.snippet_files) {
    const snippet = parse_snippet(file, text, problems);
    if (snippet) {
      snippets.push(snippet);
      snippet_paths.push(file);
    }
  }

  const registry = build_registry(commands, snippets, snippet_paths, problems);
  resolve_bindings(merged, registry, problems);
  check_config(merged, registry, problems, warnings);
  if (problems.length > 0) throw new ConfigErrors(problems);

  return {
    format_version: CONFIG_FORMAT_VERSION,
    keymap: merged.keymap,
    search_engines: merged.search_engines,
    command_aliases: merged.command_aliases,
    quickmarks: merged.quickmarks,
    settings: merged.settings,
    snippets,
    css: sources.css_files.map((file) => file.text).join("\n"),
    ...(Object.keys(local_themes).length > 0 && { local_themes }),
  };
}
