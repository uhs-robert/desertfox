// The whole pipeline: read, merge, parse snippets, parse bindings, check, assemble.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandMeta, CommandsFile } from "../../src/shared/command.ts";
import { CONFIG_FORMAT_VERSION, type MergedConfig, type SnippetEntry } from "../../src/shared/config.ts";
import { DEFAULT_PALETTE } from "../../src/shared/config.ts";
import { built_in_theme_names } from "../../src/shared/mode_colors.ts";
import type { LocalTheme } from "../../src/shared/mode_colors.ts";
import type { Theme } from "../../src/shared/theme/roles.ts";
import { build_registry, check_config, resolve_bindings } from "./check.ts";
import { ConfigErrors, is_plain_object } from "./errors.ts";
import { merge_layers, origin_key } from "./merge.ts";
import type { MergedData } from "./merge.ts";
import { parse_snippet } from "./snippet.ts";
import { read_source_files } from "./source_files.ts";
import { read_theme_dir } from "./theme_dir.ts";

export function read_commands_file(path: string): CommandMeta[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ConfigErrors([`${path}: cannot read commands.json (${(error as Error).message})`]);
  }
  if (!is_plain_object(parsed) || !Array.isArray(parsed.commands)) {
    throw new ConfigErrors([`${path}: commands.json needs a "commands" array`]);
  }
  return (parsed as CommandsFile).commands;
}

// Also rejects a palette that names no theme at all.
function pick_local_theme(merged: MergedData, local_themes: Record<string, Theme>, built_in_names: readonly string[], problems: string[]): LocalTheme | undefined {
  const name = merged.settings.palette ?? DEFAULT_PALETTE;
  if (Object.hasOwn(local_themes, name)) return { name, colors: local_themes[name]! };
  if (built_in_names.includes(name)) return undefined;
  const file = merged.origins.get(origin_key("settings", "palette")) ?? "config";
  const known = new Set([...Object.keys(local_themes), ...built_in_names]);
  problems.push(`${file}: palette: no theme named "${name}" (known: ${[...known].join(", ")})`);
  return undefined;
}

// Warnings are for config that builds but may not mean what it says.
export function build_config(config_dir: string, commands: CommandMeta[], warnings: string[] = [], built_in_names: readonly string[] = built_in_theme_names()): MergedConfig {
  const problems: string[] = [];
  const sources = read_source_files(config_dir, problems);
  const merged = merge_layers(sources.layers, problems);
  // Every local theme file is checked, not only the one `palette` names, so a broken file fails before it is picked.
  const local_theme = pick_local_theme(merged, read_theme_dir(join(config_dir, "themes"), problems), built_in_names, problems);

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
    settings: merged.settings,
    snippets,
    css: sources.css_files.map((file) => file.text).join("\n"),
    ...(local_theme && { local_theme }),
  };
}
