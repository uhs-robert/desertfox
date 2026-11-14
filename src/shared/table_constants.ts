// Constants the settings table reads for its defaults. They live apart from config.ts because config.ts imports the generated default_settings.ts: the generator that writes that file could not load the table, and so could not recreate the file once it was missing.

// The reserved value of `new_tab_page` and `home_page` that names the built-in new tab page.
export const BUILT_IN_PAGE = "desertfox";

export const FALLBACK_ENGINE_NAME = "duck";

// The names of the site rows that ship with DesertFox. `default_site_rows.ts` types each row's name from this list, and a test keeps both in step.
export const DEFAULT_SITE_ROW_NAMES = ["sheets", "maps"] as const;

// The most steps one site bind may chain. A bind runs every step in a burst, so the cap keeps a typo from sending hundreds.
export const MAX_BIND_STEPS = 20;
