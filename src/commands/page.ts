import { get_config } from "../background/startup.ts";
import { stop_page } from "../content/handlers/stop.ts";
import { NEW_TAB_PAGE_FILE } from "../shared/config.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in, require_tab_id, typed_url_target, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import { home_page_url } from "./url_build.ts";

define("page.back", {
  label: "Back",
  intent: "Go back one page in the tab history. A count prefix goes back that many pages.",
  runs_in: "background",
  count: "repeat",
  run: async (ctx) => browser.tabs.goBack(require_tab_id(ctx)),
});

define("page.forward", {
  label: "Forward",
  intent: "Go forward one page in the tab history. A count prefix goes forward that many pages.",
  runs_in: "background",
  count: "repeat",
  run: async (ctx) => browser.tabs.goForward(require_tab_id(ctx)),
});

define("page.reload", {
  label: "Reload",
  intent: "Reload the page. With hard on, skip the cache.",
  params: [{ name: "hard", type: "bool", default: false, description: "Skip the cache." }],
  runs_in: "background",
  run: async (ctx, args) => browser.tabs.reload(require_tab_id(ctx), { bypassCache: args.hard === true }),
});

// Firefox has no stop call for the tabs API, so the page itself stops.
define("page.stop", {
  label: "Stop loading",
  intent: "Stop the page from loading.",
  runs_in: "content",
  run: stop_page.run,
});

define("page.home", {
  label: "Home page",
  intent: "Open the home page from the settings.",
  params: [WHERE_PARAM],
  runs_in: "background",
  run: async (ctx, args) => {
    const home_url = home_page_url((await get_config()).settings.home_page, () => browser.runtime.getURL(NEW_TAB_PAGE_FILE));
    await open_in(ctx, await typed_url_target(home_url), args.where as Where);
  },
});
