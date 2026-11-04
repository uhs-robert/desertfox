// Draws the help model with DOM calls only. Command text never goes through innerHTML.

import type { Block, Inline } from "./blocks.ts";
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

export const command_anchor = (id: string): string => `command-${id}`;

function command_card(command: CommandRow): HTMLElement {
  const card = el(
    "section",
    "oasisfox-help-command",
    el("h3", undefined, command.label, " ", el("code", "oasisfox-help-muted", command.id)),
    el("p", undefined, command.intent),
    el("pre", "oasisfox-help-usage", command.usage),
    params_table(command),
    key_list(command.keys),
  );
  card.id = command_anchor(command.id);
  return card;
}

export const engine_anchor = (name: string): string => `engine-${name}`;

const file_name = (path: string): string => path.split("/").pop() ?? path;

function engine_row(engine: EngineRow, show_files: boolean): HTMLElement {
  const name = el("td", undefined, engine.name);
  if (engine.needs) name.append(" ", el("span", "oasisfox-help-badge", `needs ${engine.needs}`));
  if (engine.fallback) name.append(" ", el("span", "oasisfox-help-badge", `falls back to ${engine.fallback}`));
  if (show_files) {
    for (const file of engine.files) {
      const badge = el("span", "oasisfox-help-badge", file_name(file));
      badge.title = file;
      name.append(" ", badge);
    }
  }
  const keys = el("td", undefined, ...engine.keys.flatMap((sequence) => [el("kbd", undefined, sequence), " "]));
  const host = el("summary", undefined, engine.host);
  host.title = engine.url;
  const full = el("div", "oasisfox-help-muted", engine.url, ...engine.origins.map((line) => el("div", undefined, line)));
  const row = el("tr", undefined, name, el("td", undefined, engine.label), keys, el("td", undefined, el("details", undefined, host, full)));
  row.id = engine_anchor(engine.name);
  return row;
}

function engine_table(engines: EngineRow[]): HTMLElement {
  if (engines.length === 0) return el("span", "oasisfox-help-muted", "No engines.");
  const first_file = engines[0]!.files[0];
  const one_file = first_file !== undefined && engines.every((engine) => engine.files.length === 1 && engine.files[0] === first_file);
  const head = el("tr", undefined, ...["engine", "label", "keys", "url"].map((name) => el("th", undefined, name)));
  const table = el("table", "oasisfox-help-engines", head, ...engines.map((engine) => engine_row(engine, !one_file)));
  if (!one_file) return table;
  return el("div", undefined, el("p", "oasisfox-help-muted", `Set by ${first_file}`), table);
}

function inline_node(inline: Inline): Child {
  switch (inline.kind) {
    case "text": return inline.text;
    case "code": return el("code", undefined, inline.text);
    case "link": {
      const link = el("a", undefined, inline.text);
      link.setAttribute("href", inline.href);
      return link;
    }
  }
}

function block_node(block: Block): HTMLElement {
  switch (block.kind) {
    case "heading": return el(`h${block.level}`, undefined, block.text);
    case "paragraph": return el("p", undefined, ...block.inlines.map(inline_node));
    case "list": return el("ul", undefined, ...block.items.map((item) => el("li", undefined, ...item.map(inline_node))));
    case "code_block": return el("pre", "oasisfox-help-usage", block.text);
  }
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

function page_body(page: PageId, model: HelpModel, guide: Block[]): HTMLElement[] {
  switch (page) {
    case "home": return home_page(model);
    case "quick-start": return model.quick_start.map(block_node);
    case "search-engines": return [...guide.map(block_node), el("h2", undefined, "Your engines"), engine_table(model.engines)];
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

export function render_help(root: HTMLElement, model: HelpModel, route: Route, guide: Block[]): void {
  const title = PAGES.find((page) => page.id === route.page)?.title ?? "Home";
  const heading = el("h1", undefined, title);
  heading.tabIndex = -1;
  const page = el("main", "oasisfox-help-page", heading, ...page_body(route.page, model, guide));
  root.replaceChildren(el("div", "oasisfox-help", sidebar(route.page), page));
}
