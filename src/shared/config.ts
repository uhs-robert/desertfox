// The merged config the extension runs on: the shape `config.reload` builds from the config files
// and keeps in `storage.local`.

import type { CommandMeta } from "./command.ts";
import type { KeymapConfig } from "./keymap.ts";
import type { Settings } from "./settings_table.ts";
import type { Theme } from "./theme/roles.ts";
import { DEFAULT_SETTINGS } from "./default_settings.ts";
import { BUILT_IN_PAGE, FALLBACK_ENGINE_NAME } from "./table_constants.ts";

export type { Settings } from "./settings_table.ts";
export { DEFAULT_LIGHT_INTENSITY, DEFAULT_MODE_INDICATOR, DEFAULT_THEME, DEFAULT_SETTINGS } from "./default_settings.ts";

export const CONFIG_FORMAT_VERSION = 2;

export type SearchEngine = {
  // URL template. It holds the query slot and page slots; `%s` is the older spelling of the query slot.
  url: string;
  label: string;
  // What the page must provide before the engine can run there, one slot expression per entry, for example "repo". Absent when nothing.
  slots?: string[];
  // Name of the engine to use when the page cannot fill the slots.
  fallback?: string;
  // Host names of the sites the engine belongs to. Only the generated `s/` and `S/` keys read it: they offer the engine on these sites alone. Absent means every site.
  hosts?: string[];
  // One to eight lower case letters or digits, unique across engines. When the first word of a query equals it, that engine is the one to search. Never inherited by a child engine.
  keyword?: string;
  // A JavaScript regular expression with one capture group, matched against the whole results page address to read the query back. Absent means the reader comes from `url`. Never inherited.
  reverse?: string;
  // Where each field came from, for `engine.show`: field name to "file [level]".
  origins?: Record<string, string>;
};

export type WhichKeyBorder = Settings["which_key_border"];
export type ModeIndicator = Settings["mode_indicator"];
export type NewTabLink = Settings["newtab_links"][number];

export { BUILT_IN_PAGE, FALLBACK_ENGINE_NAME };
export const NEW_TAB_PAGE_FILE = "newtab.html";
// `newtab.html?builtin` draws the built-in page even when `new_tab_page` redirects, so `home_page = "desertfox"` still reaches it.
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

export const FALLBACK_ENGINE: SearchEngine = { url: "https://duckduckgo.com/?q=%s", label: "DuckDuckGo" };

// The built-in engine behind `s//`: the default engine, limited to the site of the page.
export const SITE_ENGINE_NAME = "site";

const FIRST_QUERY_SLOT = /\{query\}|%s/;

// A default engine whose URL has no plain query slot (only `{query|url}`, say), or that needs a page slot of its own, cannot take the `site:` term, so DuckDuckGo stands in.
const can_take_site_term = (engine: SearchEngine | undefined): engine is SearchEngine => engine !== undefined && FIRST_QUERY_SLOT.test(engine.url) && (engine.slots ?? []).length === 0;

function site_engine_over(default_engine: SearchEngine | undefined): SearchEngine {
  const base = can_take_site_term(default_engine) ? default_engine : FALLBACK_ENGINE;
  return { url: base.url.replace(FIRST_QUERY_SLOT, "site:{host}+{query}"), label: "This site", slots: ["host"] };
}

// A user engine with a built-in's name replaces it whole. Nothing removes the built-ins, so the default engine always resolves.
// `site` is built from the default engine at this call, so it follows the config and not a later `:set default_engine`.
export function with_fallback_engines(user_engines: Record<string, SearchEngine>, default_engine: string = FALLBACK_ENGINE_NAME): Record<string, SearchEngine> {
  const named: Record<string, SearchEngine> = { [FALLBACK_ENGINE_NAME]: FALLBACK_ENGINE, ...user_engines };
  return { [FALLBACK_ENGINE_NAME]: FALLBACK_ENGINE, [SITE_ENGINE_NAME]: site_engine_over(named[default_engine]), ...user_engines };
}

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
  // Quickmark key to address. `M` adds entries in storage on top of these.
  quickmarks: Record<string, string>;
  // Absent keys take the value in DEFAULT_SETTINGS.
  settings: Partial<Settings>;
  snippets: SnippetEntry[];
  // User CSS as text: `style.css` then `style.d/*.css`.
  css: string;
  // Every theme file of the config directory, by theme name. Absent when there is none. The imported themes of the browser join them at publish.
  local_themes?: Record<string, Theme>;
};

// One layer of settings changed in the browser, by `:set`, `:toggle` or the settings page.
export type SettingOverrides = Partial<Settings>;

// The browser edits over the config file's settings. `saved` lasts until `:unset`. `temp` (`:set --temp`) also ends when the browser restarts, and wins over `saved`.
export type SettingEdits = { saved: SettingOverrides; temp: SettingOverrides };

export const NO_EDITS: SettingEdits = { saved: {}, temp: {} };

// Applied before `effective_settings`, which fills the defaults under the result.
export function apply_edits(settings: Partial<Settings>, edits: SettingEdits): Partial<Settings> {
  return { ...settings, ...edits.saved, ...edits.temp };
}

// The settings in force: the defaults under the config's own values. The two prefix maps merge one level deeper, so a config that sets only `search_prefixes.tab` keeps the default `here`. The key compiler merges them the same way.
export function effective_settings(settings: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    search_prefixes: { ...DEFAULT_SETTINGS.search_prefixes, ...settings.search_prefixes },
    container_prefixes: { ...DEFAULT_SETTINGS.container_prefixes, ...settings.container_prefixes },
  };
}
