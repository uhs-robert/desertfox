import { get_config } from "../background/startup.ts";
import { stop_page } from "../content/handlers/stop.ts";
import { define } from "../shared/registry/index.ts";
import { open_in, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import { home_page_url } from "./url_build.ts";

function require_tab_id(tab_id: number | undefined): number {
  if (tab_id === undefined) throw new Error("No tab");
  return tab_id;
}

define("page.back", {
  name: "back",
  label: "Back",
  intent: "Go back one page in the tab history. A count prefix goes back that many pages.",
  runs_in: "background",
  count: "repeat",
  run: async (ctx) => browser.tabs.goBack(require_tab_id(ctx.tab_id)),
});

define("page.forward", {
  name: "forward",
  label: "Forward",
  intent: "Go forward one page in the tab history. A count prefix goes forward that many pages.",
  runs_in: "background",
  count: "repeat",
  run: async (ctx) => browser.tabs.goForward(require_tab_id(ctx.tab_id)),
});

define("page.reload", {
  name: "reload",
  label: "Reload",
  intent: "Reload the page. With hard set, skip the cache.",
  params: [{ name: "hard", type: "bool", default: false, flag: {} }],
  runs_in: "background",
  run: async (ctx, args) => browser.tabs.reload(require_tab_id(ctx.tab_id), { bypassCache: args.hard === true }),
});

// Firefox has no stop call for the tabs API, so the page itself stops.
define("page.stop", {
  name: "stop",
  label: "Stop Loading",
  intent: "Stop the page from loading.",
  runs_in: "content",
  run: stop_page.run,
});

define("page.home", {
  name: "home",
  label: "Home Page",
  intent: "Open the home_page from settings.jsonc.",
  params: [WHERE_PARAM],
  runs_in: "background",
  run: async (ctx, args) => {
    const home_url = home_page_url((await get_config()).settings.home_page);
    await open_in(ctx, home_url, args.where as Where);
  },
});
