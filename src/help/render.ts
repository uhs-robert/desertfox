// Draws the help model with DOM calls only. Command text never goes through innerHTML.

import { command_matches, count_line } from "./filter.ts";
import { copy_text } from "../content/caret/copy_text.ts";
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

const COPIED_LABEL_MS = 1500;

// The pending "Copy" restore per button, so a second click restarts the 1.5 s instead of being cut short.
const pending_restore = new WeakMap<object, unknown>();

// A real button, so Tab and hints reach it. The label shows the result only after the clipboard took the text.
export async function copy_code_and_confirm(
  clipboard: Parameters<typeof copy_text>[0],
  text: string,
  button: { textContent: string | null },
  later: (restore: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: never) => void = clearTimeout,
): Promise<void> {
  if (!(await copy_text(clipboard, text))) return;
  button.textContent = "Copied";
  if (pending_restore.has(button)) cancel(pending_restore.get(button) as never);
  pending_restore.set(button, later(() => { button.textContent = "Copy"; }, COPIED_LABEL_MS));
}

function code_block_node(text: string, language: string | undefined): HTMLElement {
  const button = el("button", "oasisfox-help-code-copy", "Copy");
  button.setAttribute("type", "button");
  button.addEventListener("click", () => void copy_code_and_confirm(navigator.clipboard, text, button));
  const head = el("div", "oasisfox-help-code-head", ...(language ? [el("span", "oasisfox-help-code-lang", language)] : []), button);
  return el("div", "oasisfox-help-code", head, el("pre", "oasisfox-help-code-body", text));
}

function block_node(block: Block): HTMLElement {
  switch (block.kind) {
    case "heading": return el(`h${block.level}`, undefined, block.text);
    case "paragraph": return el("p", undefined, ...block.inlines.map(inline_node));
    case "list": return el("ul", undefined, ...block.items.map((item) => el("li", undefined, ...item.map(inline_node))));
    case "code_block": return code_block_node(block.text, block.language);
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

// Kept outside the tree: every render rebuilds the page, and the text must outlive it.
let command_filter = "";

function commands_page(model: HelpModel): HTMLElement[] {
  const input = el("input", "oasisfox-help-filter") as HTMLInputElement;
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", "Filter by name, key or description");
  input.setAttribute("aria-label", "Filter commands");
  input.value = command_filter;
  const count = el("p", "oasisfox-help-filter-count oasisfox-help-muted");
  count.setAttribute("aria-live", "polite");

  const groups = model.groups.map((group) => {
    const heading = el("h2", undefined, group.name);
    return { heading, cards: group.commands.map((command) => ({ command, card: command_card(command) })) };
  });
  const total = model.groups.reduce((sum, group) => sum + group.commands.length, 0);

  const apply_filter = (): HTMLElement | undefined => {
    let shown = 0;
    let first: HTMLElement | undefined;
    for (const group of groups) {
      let group_shown = 0;
      for (const { command, card } of group.cards) {
        const match = command_matches(command, command_filter);
        card.hidden = !match;
        card.classList.remove("oasisfox-help-current");
        if (match) {
          group_shown += 1;
          first ??= card;
        }
      }
      group.heading.hidden = group_shown === 0;
      shown += group_shown;
    }
    count.textContent = count_line(shown, total);
    return first;
  };
  apply_filter();

  input.addEventListener("input", () => {
    command_filter = input.value;
    apply_filter();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = apply_filter();
      if (!first) return;
      first.classList.add("oasisfox-help-current");
      first.scrollIntoView();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // Clears first. An empty box blurs, which returns the keys to the page.
      if (input.value === "") {
        input.blur();
        return;
      }
      input.value = "";
      command_filter = "";
      apply_filter();
    }
  });

  return [input, count, ...groups.flatMap((group) => [group.heading, ...group.cards.map(({ card }) => card)])];
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
