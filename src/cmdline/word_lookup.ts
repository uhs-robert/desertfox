// Finds a command by name, alias or id the way the registry does, plus the configured `command_aliases`.
// The page has no registry because the command modules reach into the content script.

import type { CommandMeta } from "../shared/command.ts";
import type { CommandLookup } from "../shared/registry/index.ts";

// A configured alias never takes a word a command already owns, as `tools/build-config` checks.
export function create_word_lookup(commands: readonly CommandMeta[], command_aliases: Readonly<Record<string, string>> = {}): CommandLookup {
  const by_id = new Map(commands.map((command) => [command.id, command]));
  const by_word = new Map<string, CommandMeta>();
  for (const command of commands) {
    for (const word of [command.id, ...(command.name ? [command.name] : []), ...(command.aliases ?? [])]) by_word.set(word, command);
  }
  for (const [alias, command_id] of Object.entries(command_aliases)) {
    const command = by_id.get(command_id);
    if (command && !by_word.has(alias)) by_word.set(alias, command);
  }
  return { find: (word) => by_word.get(word) };
}
