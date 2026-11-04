// Draws the help model with DOM calls only. Command text never goes through innerHTML.

import type { CommandRow, EngineRow, HelpModel, KeyRow } from "./model.ts";
import { STYLE_CLASSES, STYLE_VARIABLES } from "./model.ts";
import { PAGES } from "./route.ts";
import type { PageId, Route } from "./route.ts";

type Child = Node | string;

function el(tag: string, class_name: string | undefined, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  if (class_name) node.className = class_name;
  node.append(...children);
  return node;
}

function key_list(rows: KeyRow[]): HTMLElement {
  const cell = el("div", "oasisfox-help-keys");
  if (rows.length === 0) {
    cell.append(el("span", "oasisfox-help-muted", "no keys"));
    return cell;
  }
  for (const row of rows) {
    const line = el("div", undefined, el("span", "oasisfox-help-mode", row.mode), el("kbd", undefined, row.keys));
    if (row.args) line.append(" ", el("span", "oasisfox-help-muted", row.args));
    cell.append(line);
  }
  return cell;
}

function params_table(command: CommandRow): HTMLElement | string {
  if (command.params.length === 0) return el("span", "oasisfox-help-muted", "no params");
  const head = el("tr", undefined, ...["param", "type", "default", "values", "flags"].map((name) => el("th", undefined, name)));
  const body = command.params.map((param) =>
    el("tr", undefined, ...[param.name, param.type, param.default, param.values, param.flags].map((text) => el("td", undefined, text))),
  );
  return el("table", "oasisfox-help-params", head, ...body);
}

function command_card(command: CommandRow): HTMLElement {
  return el(
    "section",
    "oasisfox-help-command",
    el("h3", undefined, command.label, " ", el("code", "oasisfox-help-muted", command.id)),
    el("p", undefined, command.intent),
    el("pre", "oasisfox-help-usage", command.usage),
    params_table(command),
    key_list(command.keys),
  );
}

export const engine_anchor = (name: string): string => `engine-${name}`;

function engine_table(engines: EngineRow[]): HTMLElement {
  if (engines.length === 0) return el("span", "oasisfox-help-muted", "No engines.");
  const head = el("tr", undefined, ...["engine", "label", "url", "needs", "falls back to", "set by"].map((name) => el("th", undefined, name)));
  const body = engines.map((engine) => {
    const row = el("tr", undefined, ...[engine.name, engine.label, engine.url, engine.needs, engine.fallback].map((text) => el("td", undefined, text)));
    row.id = engine_anchor(engine.name);
    row.append(el("td", "oasisfox-help-muted", ...engine.origins.map((line) => el("div", undefined, line))));
    return row;
  });
  return el("table", "oasisfox-help-engines", head, ...body);
}

function definition_table(rows: { name: string; meaning: string }[]): HTMLElement {
  return el("table", undefined, ...rows.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.name)), el("td", undefined, row.meaning))));
}

function home_page(model: HelpModel): HTMLElement[] {
  const warnings = model.warnings.length === 0
    ? el("p", "oasisfox-help-muted", "No warnings.")
    : el("ul", "oasisfox-help-warnings", ...model.warnings.map((warning) => el("li", undefined, warning)));
  const settings = el("table", undefined, ...model.settings.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.name)), el("td", undefined, el("code", undefined, row.value)))));
  return [
    el("h2", undefined, "Warnings"),
    warnings,
    el("h2", undefined, "Settings"),
    el("p", undefined, `Config source: ${model.config_source}. This list is read-only.`),
    settings,
  ];
}

function commands_page(model: HelpModel): HTMLElement[] {
  return model.groups.flatMap((group) => [el("h2", undefined, group.name), ...group.commands.map(command_card)]);
}

function styling_page(): HTMLElement[] {
  return [
    el("p", undefined, "Set these CSS variables in style.css to restyle OasisFox. A surface reads the roles it needs, so a role no surface reads yet has no visible effect. The class names below are stable."),
    el("h2", undefined, "Variables"),
    definition_table(STYLE_VARIABLES),
    el("h2", undefined, "Classes"),
    definition_table(STYLE_CLASSES.map((entry) => ({ ...entry, name: `.${entry.name}` }))),
  ];
}

function page_body(page: PageId, model: HelpModel): HTMLElement[] {
  switch (page) {
    case "home": return home_page(model);
    case "search-engines": return [engine_table(model.engines)];
    case "commands": return commands_page(model);
    case "styling": return styling_page();
  }
}

function sidebar(current: PageId): HTMLElement {
  const links = PAGES.map((page) => {
    const link = el("a", undefined, page.title);
    link.setAttribute("href", page.hash);
    if (page.id === current) link.setAttribute("aria-current", "page");
    return link;
  });
  return el("nav", "oasisfox-help-sidebar", el("div", "oasisfox-help-brand", "OasisFox"), ...links);
}

export function render_help(root: HTMLElement, model: HelpModel, route: Route): void {
  const title = PAGES.find((page) => page.id === route.page)?.title ?? "Home";
  const heading = el("h1", undefined, title);
  heading.tabIndex = -1;
  const page = el("main", "oasisfox-help-page", heading, ...page_body(route.page, model));
  root.replaceChildren(el("div", "oasisfox-help", sidebar(route.page), page));
}
