// Finds a command by name, alias or id from the entries of `commands.json`, the way the registry does.
// The page has no registry because the command modules reach into the content script.

import type { CommandMeta } from "../shared/command.ts";
import type { CommandLookup } from "../shared/registry/index.ts";

export function create_word_lookup(commands: readonly CommandMeta[]): CommandLookup {
  const by_word = new Map<string, CommandMeta>();
  for (const command of commands) {
    for (const word of [command.id, ...(command.name ? [command.name] : []), ...(command.aliases ?? [])]) by_word.set(word, command);
  }
  return { find: (word) => by_word.get(word) };
}
