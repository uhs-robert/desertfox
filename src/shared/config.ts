// The merged config file `tools/build-config` writes to
// `~/.mozilla/managed-storage/<extension id>.json`. Firefox hands its `data`
// to the extension through `storage.managed`.

import type { CommandMeta } from "./command.ts";
import type { KeymapConfig } from "./keymap.ts";
import { DEFAULT_PALETTE } from "./mode_colors.ts";
import type { LocalTheme } from "./mode_colors.ts";

export const CONFIG_FORMAT_VERSION = 2;

export type SearchEngine = {
  // URL template. It holds the query slot and page slots; `%s` is the older spelling of the query slot.
  url: string;
  label: string;
  // What the page must provide before the engine can run there, one slot expression per entry, for example "repo". Absent when nothing.
  slots?: string[];
  // Name of the engine to use when the page cannot fill the slots.
  fallback?: string;
  // Where each field came from, for `engine.show`: field name to "file [level]".
  origins?: Record<string, string>;
};

export const MODE_INDICATOR_VALUES = ["always", "not_normal", "off"] as const;
export const WHICH_KEY_BORDER_VALUES = ["square", "round", "chamfer"] as const;
export type WhichKeyBorder = (typeof WHICH_KEY_BORDER_VALUES)[number];

export type ModeIndicator = (typeof MODE_INDICATOR_VALUES)[number];

export type Settings = {
  which_key_delay_ms: number;
  // Corner style of the which-key panel border.
  which_key_border: WhichKeyBorder;
  hint_letters: string;
  // Match patterns for pages where OasisFox starts in ignore mode.
  ignore_sites: string[];
  // The mode badge: always (NORMAL too), only outside normal mode, or never.
  mode_indicator: ModeIndicator;
  // Theme name: `<config dir>/themes/<name>.toml` first, then a repo theme, then an oasis.nvim palette. Light or dark follows the system theme.
  palette: string;
  // Prefixes of keys generated from `search_keys`: this tab, new tab.
  search_prefixes: { here: string; tab: string };
  // Prefixes of keys generated from `container_keys`: reopen, prompt in new tab.
  container_prefixes: { reopen: string; tab: string };
  // Page that `page.home` opens: a URL, or `oasisfox` for the built-in new tab page. Without it the command refuses.
  home_page?: string;
  // Search engine name that `open.clipboard` uses when the clipboard text is not a URL. The default names the built-in fallback engine.
  default_engine: string;
  // What a new tab shows: an http or https URL, or `oasisfox` for the built-in page. Absent means the built-in page.
  new_tab_page?: string;
  // The `tab` completion list: absent or false lists the tabs of the line's window, true lists the tabs of every window.
  // Kept out of DEFAULT_SETTINGS because the content script bundles that object and has no use for this one.
  completion_all_windows?: boolean;
  // Before the command line input: "caret" (`> `), "colon", or custom text with its own trailing space. Absent is "caret".
  cmdline_prompt?: string;
  // The groups `open` completes from, in the order they list. A source left out is not read. Absent lists both.
  open_completion?: ("bookmarks" | "history")[];
  // History rows `open` shows for an empty word. Absent is 10.
  history_completion_max?: number;
  // The new tab page widgets. Each is on unless false. `true` on the clock means analog, as it did before the digital face.
  newtab_clock?: boolean | "analog" | "digital";
  newtab_date?: boolean;
  // The hours of the digital clock. Absent is 12. The analog face has no 12 or 24 form.
  newtab_clock_format?: 12 | 24;
  // Whether the first install opens the Quick Start page. On unless false. A first install has no config, so only a managed config can turn it off in time.
  open_quick_start_on_install?: boolean;
};

// The reserved value of `new_tab_page` and `home_page` that names the built-in new tab page.
export const BUILT_IN_PAGE = "oasisfox";
export const NEW_TAB_PAGE_FILE = "newtab.html";
// `newtab.html?builtin` draws the built-in page even when `new_tab_page` redirects, so `home_page = "oasisfox"` still reaches it.
export const BUILT_IN_QUERY = "builtin";

// A URL value is opened by redirect, so only web schemes are accepted: `javascript:` or `data:` would run in the extension page.
// The parse check also refuses what the scheme check lets through but `location.replace` throws on, such as a bad port.
export const is_web_url = (text: string): boolean => /^https?:\/\/\S+$/i.test(text) && URL.canParse(text);

export type NewTabTarget = { kind: "built_in" } | { kind: "redirect"; url: string };

// A value that is neither a web URL nor the reserved word falls back to the built-in page: the stored config can come from elsewhere than the build check.
export function resolve_new_tab_page(new_tab_page: string | undefined, page_query = ""): NewTabTarget {
  if (new URLSearchParams(page_query).has(BUILT_IN_QUERY)) return { kind: "built_in" };
  return new_tab_page !== undefined && is_web_url(new_tab_page) ? { kind: "redirect", url: new_tab_page } : { kind: "built_in" };
}

export const FALLBACK_ENGINE_NAME = "duck";

export const FALLBACK_ENGINE: SearchEngine = { url: "https://duckduckgo.com/?q=%s", label: "DuckDuckGo" };

// A user engine with the fallback's name replaces it whole. Nothing removes the fallback, so the default engine always resolves.
export function with_fallback_engines(user_engines: Record<string, SearchEngine>): Record<string, SearchEngine> {
  return { [FALLBACK_ENGINE_NAME]: FALLBACK_ENGINE, ...user_engines };
}

export const DEFAULT_SETTINGS: Settings = {
  which_key_delay_ms: 300,
  which_key_border: "square",
  hint_letters: "asdfghjkl",
  ignore_sites: [],
  mode_indicator: "always",
  palette: DEFAULT_PALETTE,
  search_prefixes: { here: "s", tab: "S" },
  container_prefixes: { reopen: "c", tab: "C" },
  default_engine: FALLBACK_ENGINE_NAME,
};

// A snippet becomes a registry entry. The header fills the metadata, the body is the code.
export type SnippetEntry = Omit<CommandMeta, "count"> & {
  // Match patterns. On other pages the router refuses.
  matches: string[];
  // Page slots the tab must fill before the snippet runs, for example "repo". Which-key hides the key elsewhere.
  requires?: string[];
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
  // Present only when `palette` names a theme in the config directory.
  local_theme?: LocalTheme;
};

// The settings in force: the defaults under the config's own values. The two prefix maps merge one level deeper, so a config that sets only `search_prefixes.tab` keeps the default `here`. The key compiler merges them the same way.
export function effective_settings(settings: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    search_prefixes: { ...DEFAULT_SETTINGS.search_prefixes, ...settings.search_prefixes },
    container_prefixes: { ...DEFAULT_SETTINGS.container_prefixes, ...settings.container_prefixes },
  };
}
