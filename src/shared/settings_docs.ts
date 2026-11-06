// The editor description of each setting, for `src/shared/config_build/schemas.ts` only. Kept out of `settings_table.ts`
// because the command line page bundles that table and has no room for this prose. The record type makes a setting
// without a description a compile error.

import { BUILT_IN_PAGE } from "./config.ts";
import type { SettingName } from "./settings_table.ts";

export const SETTING_DOCS: Record<SettingName, string> = {
  which_key_delay_ms: "Milliseconds after a prefix key before the which-key panel shows",
  which_key_border: "Corner style of the which-key panel border",
  hint_letters: "The letters hint labels use, each once, at least two",
  ignore_sites: "Match patterns where DesertFox starts in ignore mode",
  mode_indicator: "When the mode badge shows: always (NORMAL too), not_normal, or off",
  palette: "Theme name: themes/<name>.toml in the config directory first, then a built-in theme. Light or dark follows the system theme",
  light_intensity: "Which of the five light sets of an Oasis theme the light variant uses, 1 (lightest) to 5",
  search_prefixes: "Prefixes of the keys made from search_keys: here searches in this tab, tab in a new tab",
  container_prefixes: "Prefixes of the keys made from container_keys: reopen reopens this tab in the container, tab opens a prompt in a new container tab",
  home_page: `URL that page.home opens, or "${BUILT_IN_PAGE}" for the built-in new tab page`,
  default_engine: "Search engine that open.clipboard uses for text that is not a URL. Must name a defined engine",
  new_tab_page: `What a new tab shows: an http or https URL that the new tab redirects to, or "${BUILT_IN_PAGE}" for the built-in page. Unset means the built-in page`,
  completion_all_windows: "Whether the tab completion lists the tabs of every window, not only the line's window",
  cmdline_prompt: 'Before the command line input: "caret" for a bold > , "colon" for a primary-colored :, or your own text (include the trailing space you want)',
  open_completion: "Groups that open completes from, in list order. A source left out is not read. Default is both",
  history_completion_max: "History rows that open completion shows for an empty word",
  newtab_clock: 'The new tab page clock: false hides it, true or "analog" shows the analog face, "digital" shows the seven-segment digits',
  newtab_date: "Whether the new tab page shows the date under the clock",
  newtab_clock_format: "Hours on the digital clock: 12 with an AM or PM suffix, or 24. The analog clock ignores it",
  newtab_bookmarks: "Whether the new tab page lists your bookmarks, newest added first",
  newtab_bookmarks_max: "Bookmark rows on the new tab page",
  newtab_recent_tabs: "Whether the new tab page lists your open tabs, last used first. Private tabs never show",
  newtab_recent_tabs_max: "Recent tab rows on the new tab page",
  newtab_links: "Links on the new tab page, one [[newtab_links]] table each. Links with the same group share a list",
  open_quick_start_on_install: "Whether the first install opens the Quick Start page. A first install has no config yet, so this helps managed setups, which carry the config from the start",
};
