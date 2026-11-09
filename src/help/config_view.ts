// Turns the config status into the config source line and the apply steps for the help page's Settings. No DOM here, so tests read the rows.

import type { ConfigSource, ConfigStatus } from "../background/config_load.ts";

export type ConfigView = {
  source_text: string;
  rebuild_steps: string[];
};

const SOURCE_TEXT: Record<ConfigSource, string> = {
  files: "Config files, read by config.reload through the native host",
  defaults: "Built-in defaults, no config found",
};

// A status stored by an older version can name a source this version dropped, such as "managed", until the first publish overwrites it.
const UNKNOWN_SOURCE_TEXT = "Unknown config source, it updates when the background next loads the config";

// The same for every source: `config.reload` reads the files whatever source gave the config at startup.
const RELOAD_STEPS = ["native.install (once, to set up the native host)", "config.reload (key qr)"];

export function build_config_view(status: ConfigStatus | undefined): ConfigView {
  return {
    source_text: status ? (SOURCE_TEXT[status.source] ?? UNKNOWN_SOURCE_TEXT) : "Unknown, the background has not written a status yet",
    rebuild_steps: RELOAD_STEPS,
  };
}
