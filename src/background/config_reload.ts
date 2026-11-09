// The pure half of `config.reload` and of a config import: raw file text in, the config to store and run out.
// Its own file because the build pulls in smol-toml, and `config_load.ts` also goes into the help and new tab pages.

import type { CommandMeta } from "../shared/command.ts";
import type { MergedConfig } from "../shared/config.ts";
import { build_config } from "../shared/config_build/build_config.ts";
import { ConfigErrors } from "../shared/config_build/errors.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { pick_config } from "./config_load.ts";
import type { FilesSlot, LoadedConfig } from "./config_load.ts";

export type ApplyAction = "reload" | "import";

export const KEPT_CURRENT: Record<ApplyAction, string> = {
  reload: "Config not reloaded, the current one stays.",
  import: "Config not imported, the current one stays.",
};

// Every reason a reload or an import keeps the current config. The message is the whole toast: the cause and what to do.
export class ConfigRefusal extends Error {
  override name = "ConfigRefusal";
}

const PROBLEMS_SHOWN = 3;

// `stored` goes to `storage.local` as it is, so a restart picks it the same way the swap did.
export function build_files_config(files: ConfigFiles, dir_label: string, commands: CommandMeta[], action: ApplyAction): { stored: FilesSlot; loaded: LoadedConfig } {
  const build_warnings: string[] = [];
  let config: MergedConfig;
  try {
    config = build_config(files, commands, build_warnings, { dir_label });
  } catch (error) {
    if (!(error instanceof ConfigErrors)) throw error;
    const shown = error.problems.slice(0, PROBLEMS_SHOWN).join("; ");
    const more = error.problems.length > PROBLEMS_SHOWN ? `; and ${error.problems.length - PROBLEMS_SHOWN} more` : "";
    throw new ConfigRefusal(`${KEPT_CURRENT[action]} Fix the files and ${action} again. ${error.problems.length} problem(s): ${shown}${more}`);
  }
  const loaded = pick_config(config);
  return { stored: { config, warnings: build_warnings }, loaded: { ...loaded, warnings: [...build_warnings, ...loaded.warnings] } };
}
