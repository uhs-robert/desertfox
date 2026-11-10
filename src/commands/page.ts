import { get_config } from "../background/startup.ts";
import { NEW_TAB_PAGE_FILE } from "../shared/config.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in, require_tab_id, typed_url_target, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import { home_page_url } from "./url_build.ts";
import { browser_reload_clear_deps, make_reload_clear } from "./reload_clear.ts";
import type { ClearScope } from "./reload_clear.ts";

const reload_clear = make_reload_clear(browser_reload_clear_deps);

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
  intent: "Reload the page. With hard on, skip the cache. With clear set to site, first clear the cookies of this page's host in its container, plus the cookies a parent domain sets for it, the page's own storage and service workers, and the whole cache. With clear set to all, first clear them for every site and container.",
  params: [
    { name: "hard", type: "bool", default: false, description: "Skip the cache." },
    {
      name: "clear",
      type: "enum",
      values: ["site", "all"],
      optional: true,
      value_labels: { site: "after clearing this site", all: "after clearing every site" },
      description: { site: "Clear this host first.", all: "Clear every site and container first." },
    },
  ],
  runs_in: "background",
  // `page.reload --all` logs you out everywhere, so `.` and a macro never replay it.
  repeatable: (args) => args.clear !== "all",
  run: async (ctx, args) => {
    const tab_id = require_tab_id(ctx);
    if (args.clear === "site" || args.clear === "all") return reload_clear.run(tab_id, args.clear as ClearScope);
    return browser.tabs.reload(tab_id, { bypassCache: args.hard === true });
  },
});

// Firefox has no stop call for the tabs API, so the page itself stops.
define("page.stop", {
  label: "Stop loading",
  intent: "Stop the page from loading.",
  runs_in: "content",
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

// The link search sits in the hints bundle, which loads on the first run. It reads the top page and same-origin frames only: a frame of another site has its own script and the top page cannot see its links.
define("page.follow", {
  label: "Follow page link",
  intent: "Go to the next or previous page of a series. It takes a link marked rel next or prev first, then the link or button whose text best matches the next_patterns or prev_patterns setting: an earlier pattern wins, then a link over a button, then the shorter text.",
  params: [{ name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to next page", prev: "to previous page" }, description: { next: "Follow the link to the next page.", prev: "Follow the link to the previous page." } }, WHERE_PARAM],
  runs_in: "content",
  bundle: "hints",
});

// Both keys start from the focused control, else the last one Escape left, else the top of the view. It stops at the ends and does not wrap.
define("page.focus_field", {
  label: "Focus form control",
  intent: "Focus the next or previous form control. It visits text fields, selects, checkboxes, radios and buttons in page order. A count prefix moves that many controls. It stops with a notice past the last or before the first control.",
  params: [
    { name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to next control", prev: "to previous control" }, description: { next: "Focus the next form control.", prev: "Focus the previous form control." } },
    { name: "steps", type: "int", default: 1, min: 1, description: "Move this many controls." },
  ],
  runs_in: "content",
  count: { param: "steps" },
  bundle: "hints",
});

// Both keys start from the last heading they jumped to while it is on screen, else from the top of the view. They stop at the ends and do not wrap.
define("page.heading", {
  label: "Go to heading",
  intent: "Scroll the next or previous heading to the top of the view. It counts h1 to h6 and role=heading, in page order, from the last heading it jumped to while that is on screen, else from the top of the view. A count prefix moves that many headings. It stops with a notice past the last or before the first heading.",
  params: [
    { name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to next heading", prev: "to previous heading" }, description: { next: "Scroll the next heading to the top.", prev: "Scroll the previous heading to the top." } },
    { name: "steps", type: "int", default: 1, min: 1, description: "Move this many headings." },
  ],
  runs_in: "content",
  count: { param: "steps" },
  bundle: "hints",
});
