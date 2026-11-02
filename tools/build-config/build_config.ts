// The whole pipeline: read, merge, parse snippets, parse bindings, check, assemble.

import { readFileSync } from "node:fs";
import type { CommandMeta, CommandsFile } from "../../src/shared/command.ts";
import { CONFIG_FORMAT_VERSION, type MergedConfig, type SnippetEntry } from "../../src/shared/config.ts";
import { build_registry, check_config, resolve_bindings } from "./check.ts";
import { ConfigErrors, is_plain_object } from "./errors.ts";
import { merge_layers } from "./merge.ts";
import { parse_snippet } from "./snippet.ts";
import { read_source_files } from "./source_files.ts";

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

export function build_config(config_dir: string, commands: CommandMeta[]): MergedConfig {
  const problems: string[] = [];
  const sources = read_source_files(config_dir, problems);
  const merged = merge_layers(sources.layers, problems);

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
  check_config(merged, registry, problems);
  if (problems.length > 0) throw new ConfigErrors(problems);

  return {
    format_version: CONFIG_FORMAT_VERSION,
    keymap: merged.keymap,
    search_engines: merged.search_engines,
    command_aliases: merged.command_aliases,
    settings: merged.settings,
    snippets,
    css: sources.css_files.map((file) => file.text).join("\n"),
  };
}
