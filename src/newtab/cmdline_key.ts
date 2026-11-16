// The key that opens the command line, read from the stored keymap the way the help page reads it. A keymap that has no such key gives undefined. A read that fails rejects, and the page keeps the key it drew.

import { CMDLINE_BINDING, key_paths } from "../shared/bound_keys.ts";
import { load_commands_file } from "../shared/load_commands.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";

export type CmdlineKeyReader = () => Promise<string | undefined>;

export const browser_cmdline_key: CmdlineKeyReader = async () => {
  const [stored, commands_file] = await Promise.all([browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY), load_commands_file()]);
  return key_paths(current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined), commands_file.commands, CMDLINE_BINDING)[0]?.join("");
};
