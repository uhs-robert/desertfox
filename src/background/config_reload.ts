// The pure half of `config.reload` and of a config import: raw file text in, the config to store and run out.
// Its own file because the build pulls in smol-toml, and `config_load.ts` also goes into the help and new tab pages.

import type { CommandMeta } from "../shared/command.ts";
import type { MergedConfig } from "../shared/config.ts";
import { build_config } from "../shared/config_build/build_config.ts";
import { ConfigErrors } from "../shared/config_build/errors.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { pick_config } from "./config_load.ts";
import type { FilesSlot, LoadedConfig } from "./config_load.ts";

export type ApplyAction = "reload" | "import" | "remove" | "edit" | "layer";

export const KEPT_CURRENT: Record<ApplyAction, string> = {
  reload: "Config not reloaded, the current one stays.",
  import: "Config not imported, the current one stays.",
  remove: "Snippet not removed, the current config stays.",
  edit: "File not saved, the current config stays.",
  layer: "Edit not saved, the current config stays.",
};

// The answer a settings page message gives for a thrown error: the text, and every build problem when the build refused.
export const failure = (error: unknown): { ok: false; message: string; problems?: string[] } => ({ ok: false, message: error instanceof Error ? error.message : String(error), ...(error instanceof Error && "problems" in error && Array.isArray(error.problems) && { problems: error.problems as string[] }) });

// Every reason a reload or an import keeps the current config. The message is the whole toast: the cause and what to do.
// `problems` holds every build problem when the build refused, for a page that lists them all. The message shows the first few.
export class ConfigRefusal extends Error {
  override name = "ConfigRefusal";
  problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(message);
    this.problems = problems;
  }
}

const AGAIN_VERB: Record<ApplyAction, string> = { reload: "reload", import: "import", remove: "remove", edit: "save", layer: "save" };

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
    throw new ConfigRefusal(`${KEPT_CURRENT[action]} Fix the files and ${AGAIN_VERB[action]} again. ${error.problems.length} problem(s): ${shown}${more}`, error.problems);
  }
  const loaded = pick_config(config);
  return { stored: { config, warnings: build_warnings }, loaded: { ...loaded, warnings: [...build_warnings, ...loaded.warnings] } };
}
