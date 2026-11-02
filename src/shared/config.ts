// The merged config file `tools/build-config` writes to
// `~/.mozilla/managed-storage/<extension id>.json`. Firefox hands its `data`
// to the extension through `storage.managed`.

import type { CommandMeta } from "./command.ts";
import type { KeymapConfig } from "./keymap.ts";
import { DEFAULT_PALETTE } from "./mode_colors.ts";
import type { PaletteName } from "./mode_colors.ts";

export const CONFIG_FORMAT_VERSION = 1;

export type SearchEngine = {
  // URL template with the query placeholder.
  url: string;
  label: string;
};

export const MODE_INDICATOR_VALUES = ["always", "not_normal", "off"] as const;
export type ModeIndicator = (typeof MODE_INDICATOR_VALUES)[number];

export type Settings = {
  which_key_delay_ms: number;
  hint_letters: string;
  // Match patterns for pages where OasisFox starts in ignore mode.
  ignore_sites: string[];
  // The mode badge: always (NORMAL too), only outside normal mode, or never.
  mode_indicator: ModeIndicator;
  // Colors of both mode badges: the oasis.nvim palette. Light or dark follows the system theme.
  palette: PaletteName;
  // Prefixes of keys generated from `search_keys`: this tab, new tab.
  search_prefixes: { here: string; tab: string };
  // Prefixes of keys generated from `container_keys`: reopen, prompt in new tab.
  container_prefixes: { reopen: string; tab: string };
  // Page that `page.home` opens. Without it the command refuses.
  home_page?: string;
  // Search engine name that `open.clipboard` uses when the clipboard text is not a URL.
  default_engine: string;
  // Reserved. Decided in phase 3.
  new_tab_page?: string;
};

export const DEFAULT_SETTINGS: Settings = {
  which_key_delay_ms: 300,
  hint_letters: "asdfghjkl",
  ignore_sites: [],
  mode_indicator: "always",
  palette: DEFAULT_PALETTE,
  search_prefixes: { here: "s", tab: "S" },
  container_prefixes: { reopen: "c", tab: "C" },
  default_engine: "search",
};

// A snippet becomes a registry entry. The header fills the metadata, the body is the code.
export type SnippetEntry = Omit<CommandMeta, "count" | "modes"> & {
  // Match patterns. On other pages the router refuses.
  matches: string[];
  // Source text, run in the tab's content script with `args` defined.
  code: string;
};

export type MergedConfig = {
  format_version: typeof CONFIG_FORMAT_VERSION;
  keymap: KeymapConfig;
  // Engine name to engine.
  search_engines: Record<string, SearchEngine>;
  // Extra command line name to command id.
  command_aliases: Record<string, string>;
  // Absent keys take the value in DEFAULT_SETTINGS.
  settings: Partial<Settings>;
  snippets: SnippetEntry[];
  // User CSS as text: `style.css` then `style.d/*.css`.
  css: string;
};
