// Turns the config status into the config source line and the apply steps for the help page's Settings. No DOM here, so tests read the rows.

import type { ConfigSource, ConfigStatus } from "../background/config_load.ts";

export type ConfigView = {
  source_text: string;
  rebuild_steps: string[];
};

const SOURCE_TEXT: Record<ConfigSource, string> = {
  files: "Your settings come from the settings files in the folder",
  defaults: "You use the built-in defaults, because DesertFox found no settings files",
};

// A status stored by an older version can name a source this version dropped, such as "managed", until the first publish overwrites it.
const UNKNOWN_SOURCE_TEXT = "DesertFox does not know yet where your settings come from. This updates when it next loads them";

// The same for every source: `config.reload` reads the files whatever source gave the settings at startup.
const RELOAD_STEPS = ["Set up the native host once, with the button below or the command native.install.", "Press ,r (the command config.reload) to load your changes."];

export function build_config_view(status: ConfigStatus | undefined): ConfigView {
  return {
    source_text: status ? (SOURCE_TEXT[status.source] ?? UNKNOWN_SOURCE_TEXT) : "DesertFox has not recorded where your settings come from yet",
    rebuild_steps: RELOAD_STEPS,
  };
}
