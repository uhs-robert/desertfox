// The pure half of `config.reload`: the host's file list in, the config to store and run out.
// Its own file because the build pulls in smol-toml, and `config_load.ts` also goes into the help and new tab pages.

import type { CommandMeta } from "../shared/command.ts";
import type { MergedConfig } from "../shared/config.ts";
import { build_config } from "../shared/config_build/build_config.ts";
import { ConfigErrors } from "../shared/config_build/errors.ts";
import { pick_config } from "./config_load.ts";
import type { FilesSlot, LoadedConfig } from "./config_load.ts";
import type { ConfigFilesReply } from "./native_client.ts";

export const KEPT_CURRENT = "Config not reloaded, the current one stays.";

// Every reason a reload keeps the current config. The message is the whole toast: the cause and what to do.
export class ConfigReloadError extends Error {
  override name = "ConfigReloadError";
}

const PROBLEMS_SHOWN = 3;

// `stored` goes to `storage.local` as it is, so a restart picks it the same way the reload did.
export function build_files_config(reply: ConfigFilesReply, commands: CommandMeta[]): { stored: FilesSlot; loaded: LoadedConfig } {
  // An empty build here would replace the user's config with the defaults, most likely because the host reads the wrong folder.
  if (!reply.config_dir_exists) {
    throw new ConfigReloadError(`${KEPT_CURRENT} The native host found no config folder at ${reply.config_dir}. Create it, or set DESERTFOX_CONFIG_DIR for the host.`);
  }
  const build_warnings: string[] = [];
  let config: MergedConfig;
  try {
    config = build_config(reply.files, commands, build_warnings, { dir_label: reply.config_dir });
  } catch (error) {
    if (!(error instanceof ConfigErrors)) throw error;
    const shown = error.problems.slice(0, PROBLEMS_SHOWN).join("; ");
    const more = error.problems.length > PROBLEMS_SHOWN ? `; and ${error.problems.length - PROBLEMS_SHOWN} more` : "";
    throw new ConfigReloadError(`${KEPT_CURRENT} Fix the files and reload again. ${error.problems.length} problem(s): ${shown}${more}`);
  }
  const loaded = pick_config(config, undefined);
  return { stored: { config, warnings: build_warnings }, loaded: { ...loaded, warnings: [...build_warnings, ...loaded.warnings] } };
}
