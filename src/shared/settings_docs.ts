// The editor description of each setting, for `src/shared/config_build/schemas.ts` only. Kept out of `settings_table.ts`
// because the command line page bundles that table and has no room for this prose. The record type makes a setting
// without a description a compile error.

import { BUILT_IN_PAGE } from "./config.ts";
import type { SettingName } from "./settings_table.ts";

export const SETTING_DOCS: Record<SettingName, string> = {
  which_key_delay_ms: "Milliseconds after a prefix key before the which-key panel first shows, later keys redraw it at once",
  which_key_border: "Corner style of the which-key panel border",
  next_patterns: "Link texts that \`page.follow\` takes for the next page, best first",
  prev_patterns: "Link texts that \`page.follow\` takes for the previous page, best first",
  hint_letters: "The letters hint labels use, each once, at least two",
  blur_on_load: "Take the focus away from a field that the page focuses as it loads, so keys work at once. It stops at a key or click, or about 1 s after DesertFox starts on the page. Per-site: set it in a site_rules row to turn it on for those sites only",
  hint_key_line: "Show the line of hint keys at the bottom right while hint mode is open",
  site_rules: "The site table. Each row has a site (a match pattern) and optional columns, and each column resolves on its own: the first row that fits the page and sets the column decides it. off = true turns every normal-mode key off and starts the page in ignore mode, and a row with nothing but site does the same. off = false keeps a page on under a broader off row. pass lists keys that go to the page, only lists the only keys that stay on besides <C-v> and <S-Escape>; together they are one column, and a row may not set both. A setting marked per-site may also be a column, and its site value beats :set there",
  mode_indicator: "When the mode badge shows: always (NORMAL too), not_normal, or off",
  palette: "Theme name: themes/<name>.toml in the config directory first, then a built-in theme. Light or dark follows the system theme",
  light_intensity: "Which of the five light sets of an Oasis theme the light variant uses, 1 (lightest) to 5",
  search_prefixes: "Prefixes of the keys made from search_keys: here searches in this tab, tab in a new tab",
  container_prefixes: "Prefixes of the keys made from container_keys: reopen reopens this tab in the container, tab opens a prompt in a new container tab",
  home_page: `URL that page.home opens, or "${BUILT_IN_PAGE}" for the built-in new tab page`,
  default_engine: "Search engine that open.clipboard uses for text that is not a URL. Must name a defined engine",
  new_tab_page: `What a new tab shows: an http or https URL that the new tab redirects to, or "${BUILT_IN_PAGE}" for the built-in page. Unset means the built-in page`,
  completion_all_windows: "Whether the tab completion lists the tabs of every window, not only the line's window",
  bridge: "Whether the extension opens the native bridge (a host program that publishes the mode to a desktop shell). Needs the nativeMessaging permission and the bridge host",
  cmdline_prompt: 'Before the command line input: "caret" for a bold > , "colon" for a primary-colored :, or your own text (include the trailing space you want)',
  open_completion: "Groups that open completes from, in list order. A source left out is not read. Default is both",
  statusbar_widgets: "Widgets on the right of the open command line, in list order: url (colored by security), scroll (Top, N%, Bot or All) and tabs ([n/m]). An empty list hides the area",
  history_completion_max: "History rows that open completion shows for an empty word",
  history_list_max: "History rows that the history command lists for an empty word",
  newtab_clock: 'The new tab page clock: false hides it, true or "analog" shows the analog face, "digital" shows the seven-segment digits',
  newtab_date: "Whether the new tab page shows the date under the clock",
  newtab_clock_format: "Hours on the digital clock: 12 with an AM or PM suffix, or 24. The analog clock ignores it",
  newtab_bookmarks: "Whether the new tab page lists your bookmarks, newest added first",
  newtab_bookmarks_max: "Bookmark rows on the new tab page",
  newtab_recent_tabs: "Whether the new tab page lists your open tabs, last used first. Private tabs never show",
  newtab_recent_tabs_max: "Recent tab rows on the new tab page",
  newtab_links: "Links on the new tab page, one [[newtab_links]] table each. Links with the same group share a list",
};
