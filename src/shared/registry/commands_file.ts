import type { CommandDef, CommandMeta, CommandsFile } from "../command.ts";
import type { Registry } from "./define.ts";

export function command_meta(command: CommandDef): CommandMeta {
  const meta: CommandMeta = { id: command.id, label: command.label, intent: command.intent };
  if (command.name !== undefined) meta.name = command.name;
  if (command.aliases !== undefined) meta.aliases = command.aliases;
  if (command.params !== undefined) meta.params = command.params;
  if (command.flags !== undefined) meta.flags = command.flags;
  if (command.count !== undefined) meta.count = command.count;
  if (command.modes !== undefined) meta.modes = command.modes;
  return meta;
}

export function build_commands_file(registry: Registry): CommandsFile {
  return { format_version: 1, commands: registry.list().map(command_meta) };
}
