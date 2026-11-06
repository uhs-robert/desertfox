// Constants the settings table reads for its defaults. They live apart from config.ts because config.ts imports the generated default_settings.ts: the generator that writes that file could not load the table, and so could not recreate the file once it was missing.

// The reserved value of `new_tab_page` and `home_page` that names the built-in new tab page.
export const BUILT_IN_PAGE = "desertfox";

export const FALLBACK_ENGINE_NAME = "duck";
