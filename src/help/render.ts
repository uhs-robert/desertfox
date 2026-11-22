// Draws the help model with DOM calls only. Command text never goes through innerHTML.

import type { Block } from "./blocks.ts";
import type { HelpModel } from "./model.ts";
import { advanced_count, visible_commands_model } from "./model.ts";
import { menu_icon } from "../shared/icons.ts";
import { PAGES } from "../shared/page/help_route.ts";
import type { Route } from "../shared/page/help_route.ts";
import { el } from "./dom.ts";
import { commands_page } from "./commands_view.ts";
import { home_keycap, home_page } from "./home_view.ts";
import { practice_page } from "./practice_page.ts";
import { quick_start_page } from "./quick_start_view.ts";
import { search_engines_page } from "./search_engines_view.ts";
import { settings_page } from "./settings_view.ts";
import { SIDEBAR_ID, follow_current_section, sidebar, wire_drawer } from "./sidebar.ts";
import { site_rules_page } from "./site_rules_list_view.ts";
import { styling_page } from "./styling_view.ts";

function page_body(route: Route, model: HelpModel, guide: Block[], advanced_total: number): HTMLElement[] {
  switch (route.page) {
    case "home": return home_page(model);
    case "settings": return settings_page(model);
    case "quick-start": return quick_start_page(model.quick_start);
    case "practice": return practice_page(model.practice);
    case "search-engines": return search_engines_page(guide, model);
    case "commands": return commands_page(model, route.advanced === true, advanced_total);
    case "styling": return styling_page();
    case "site-rules": return site_rules_page(model, route.address);
  }
}


export function render_help(root: HTMLElement, full_model: HelpModel, route: Route, guide: Block[]): void {
  const model = visible_commands_model(full_model, route.advanced === true, route.command);
  const advanced_total = advanced_count(full_model);
  const title = PAGES.find((page) => page.id === route.page)?.title ?? "Home";
  const heading = el("h1", undefined, title);
  heading.tabIndex = -1;
  // The home header holds the keycap above the title, so the logo stays with the title and not with the tip below.
  const header = route.page === "home" ? el("header", "desertfox-help-home-header", home_keycap(), heading) : heading;
  const page = el("main", "desertfox-help-page", header, ...page_body(route, model, guide, advanced_total));
  // The sidebar scrolls on its own, so a fresh one starts at the top. Scroll is set after it is in the tree because a detached element ignores it.
  const old_scroll_top = root.querySelector(".desertfox-help-sidebar")?.scrollTop ?? 0;
  const sidebar_node = sidebar(route.page, model, guide, route.advanced === true);
  sidebar_node.id = SIDEBAR_ID;
  const menu_toggle = el("button", "desertfox-help-menu-toggle", menu_icon());
  menu_toggle.setAttribute("type", "button");
  menu_toggle.setAttribute("aria-label", "Menu");
  menu_toggle.setAttribute("aria-controls", SIDEBAR_ID);
  menu_toggle.setAttribute("aria-expanded", "false");
  const backdrop = el("div", "desertfox-help-backdrop");
  const top_bar = el("header", "desertfox-help-topbar", menu_toggle, el("div", "desertfox-help-brand", "DesertFox"));
  const help = el("div", "desertfox-help", top_bar, backdrop, sidebar_node, page);
  wire_drawer(help, menu_toggle, sidebar_node, backdrop, heading);
  root.replaceChildren(help);
  sidebar_node.scrollTop = old_scroll_top;
  follow_current_section(sidebar_node, page);
}
