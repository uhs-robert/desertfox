// Draws the help model with DOM calls only. Command text never goes through innerHTML.

import type { CommandRow, EngineRow, HelpModel, KeyRow } from "./model.ts";
import { STYLE_CLASSES, STYLE_VARIABLES } from "./model.ts";

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

function engine_table(engines: EngineRow[]): HTMLElement | string {
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

export function render_help(root: HTMLElement, model: HelpModel): void {
  const page = el("main", "oasisfox-help-page", el("h1", undefined, "OasisFox help"));

  page.append(el("h2", undefined, "Warnings"));
  if (model.warnings.length === 0) page.append(el("p", "oasisfox-help-muted", "No warnings."));
  else page.append(el("ul", "oasisfox-help-warnings", ...model.warnings.map((warning) => el("li", undefined, warning))));

  page.append(el("h2", undefined, "Engines"), engine_table(model.engines));

  page.append(el("h2", undefined, "Commands"));
  for (const group of model.groups) {
    page.append(el("h2", undefined, group.name), ...group.commands.map(command_card));
  }

  page.append(
    el("h2", undefined, "Styling"),
    el("p", undefined, "Set these CSS variables in style.css to restyle OasisFox. The class names below are stable."),
    definition_table(STYLE_VARIABLES),
    definition_table(STYLE_CLASSES.map((entry) => ({ ...entry, name: `.${entry.name}` }))),
  );
  root.replaceChildren(el("div", "oasisfox-help", page));
}
