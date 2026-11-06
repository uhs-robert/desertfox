// Reads the config directory and the command list from disk, then runs the shared pipeline.

import { readFileSync } from "node:fs";
import type { CommandMeta, CommandsFile } from "../../src/shared/command.ts";
import type { MergedConfig } from "../../src/shared/config.ts";
import { build_config as build_config_from_files } from "../../src/shared/config_build/build_config.ts";
import { ConfigErrors, is_plain_object } from "../../src/shared/config_build/errors.ts";
import { built_in_theme_names } from "../../src/shared/theme/load.ts";
import { config_dir_exists, read_config_files } from "./source_files.ts";

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

export function build_config(config_dir: string, commands: CommandMeta[], warnings: string[] = [], built_in_names: readonly string[] = built_in_theme_names()): MergedConfig {
  if (!config_dir_exists(config_dir)) throw new ConfigErrors([`${config_dir}: config directory not found`]);
  return build_config_from_files(read_config_files(config_dir), commands, warnings, { dir_label: config_dir, built_in_names });
}
