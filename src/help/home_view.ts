// The Home page and the keycap above its title.

import type { HelpModel } from "./model.ts";
import { block_node, el, page_link } from "./dom.ts";
import { section_anchor } from "./sections.ts";

export function home_keycap(): HTMLElement {
  const keycap = document.createElement("img");
  keycap.className = "desertfox-help-keycap";
  keycap.setAttribute("src", "icons/desertfox-keycap.svg");
  keycap.setAttribute("alt", "");
  return keycap;
}

export function home_page(model: HelpModel): HTMLElement[] {
  const steps = el(
    "ul",
    undefined,
    el("li", undefined, page_link("Quick Start", "quick-start"), ": learn the first keys in five minutes."),
    el("li", undefined, page_link("Settings", "settings"), ": change colors, keys, search engines and more."),
    el("li", undefined, page_link("Commands", "commands"), ": see everything DesertFox can do."),
  );
  // The popup's warning count links to this heading.
  const problems_heading = el("h2", undefined, "Problems in your setup");
  problems_heading.id = section_anchor("home", "warnings");
  problems_heading.tabIndex = -1;
  const problems = model.warnings.length === 0 ? [] : [problems_heading, el("ul", "desertfox-help-warnings", ...model.warnings.map((warning) => el("li", undefined, warning)))];
  return [el("p", undefined, "DesertFox lets you use Firefox from the keyboard. You can scroll, click links, search and switch tabs without the mouse."), el("h2", undefined, "Start here"), steps, block_node(model.tip), ...problems];
}
