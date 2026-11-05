// Draws the help model with DOM calls only. Command text never goes through innerHTML.

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
    case "code": return el("code", "oasisfox-help-inline-code", inline.text);
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
    case "tip": return el("div", "oasisfox-help-tip", el("strong", "oasisfox-help-tip-label", "Tip"), ": ", ...block.inlines.map(inline_node));
    case "list": return el("ul", undefined, ...block.items.map((item) => el("li", undefined, ...item.map(inline_node))));
    case "code_block": return code_block_node(block.text, block.language);
  }
}

// The level-2 headings of the guide get the ids the sidebar links to. Their slugs come from the same list, in order.
function quick_start_page(blocks: Block[]): HTMLElement[] {
  const sections = [...page_sections("quick-start", blocks)];
  return blocks.map((block) => {
    if (block.kind !== "heading" || block.level !== 2) return block_node(block);
    return section_heading("quick-start", sections.shift()!);
  });
}

function definition_table(rows: { name: string; meaning: string }[]): HTMLElement {
  return el("table", undefined, ...rows.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.name)), el("td", undefined, row.meaning))));
}

function home_page(model: HelpModel): HTMLElement[] {
  const [warnings_section, settings_section] = HOME_SECTIONS as [Section, Section];
  const warnings = model.warnings.length === 0
    ? el("p", "oasisfox-help-muted", "No warnings.")
    : el("ul", "oasisfox-help-warnings", ...model.warnings.map((warning) => el("li", undefined, warning)));
  const settings = el("table", undefined, ...model.settings.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.name)), el("td", undefined, el("code", undefined, row.value)))));
  return [
    block_node(model.tip),
    section_heading("home", warnings_section),
    warnings,
    section_heading("home", settings_section),
    el("p", undefined, `Config source: ${model.config_source}. This list is read-only.`),
    settings,
  ];
}

function commands_page(model: HelpModel): HTMLElement[] {
  const sections = page_sections("commands", model);
  return [
    block_node(model.tip),
    ...model.groups.flatMap((group, index) => [section_heading("commands", sections[index]!), ...group.commands.map(command_card)]),
  ];
}

function styling_page(): HTMLElement[] {
  const [variables_section, classes_section] = STYLING_SECTIONS as [Section, Section];
  return [
    el("p", undefined, "Set these CSS variables in style.css to restyle OasisFox. A surface reads the roles it needs, so a role no surface reads yet has no visible effect. The class names below are stable."),
    section_heading("styling", variables_section),
    definition_table(STYLE_VARIABLES),
    section_heading("styling", classes_section),
    definition_table(STYLE_CLASSES.map((entry) => ({ ...entry, name: `.${entry.name}` }))),
  ];
}

function page_body(route: Route, model: HelpModel, guide: Block[]): HTMLElement[] {
  switch (route.page) {
    case "home": return home_page(model);
    case "quick-start": return quick_start_page(model.quick_start);
    case "search-engines": return [...guide.map(block_node), el("h2", undefined, "Your engines"), engine_table(model.engines)];
    case "commands": return commands_page(model);
    case "styling": return styling_page();
  }
}

function support_link(title: string, url: string): HTMLElement {
  const link = el("a", undefined, title);
  link.setAttribute("href", url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  return link;
}

function support_line(): HTMLElement {
  return el(
    "div",
    "oasisfox-help-support",
    "Enjoying OasisFox? Support it: ",
    support_link("GitHub Sponsors", "https://github.com/sponsors/uhs-robert"),
    " or ",
    support_link("Ko-fi", "https://ko-fi.com/uphillsolutions"),
  );
}

export const section_anchor = (page: PageId, slug: string): string => `${page}-${slug}`;

export type Section = { title: string; slug: string };

// Slugs are unique within a page, because they become element ids and route values. A repeat or a title with no letters gets a number.
export function sections_from_titles(titles: string[]): Section[] {
  const seen = new Set<string>();
  return titles.map((title) => {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    let slug = base;
    for (let count = 2; seen.has(slug); count += 1) slug = `${base}-${count}`;
    seen.add(slug);
    return { title, slug };
  });
}

const HOME_SECTIONS = sections_from_titles(["Warnings", "Settings"]);
const STYLING_SECTIONS = sections_from_titles(["Variables", "Classes"]);

// The sections a page lists in the sidebar. Search Engines has none, because its guide loads late and its headings have no ids.
export function page_sections(page: PageId, source: HelpModel | Block[]): Section[] {
  const quick_start = Array.isArray(source) ? source : source.quick_start;
  switch (page) {
    case "home": return HOME_SECTIONS;
    case "quick-start": return sections_from_titles(quick_start.flatMap((block) => (block.kind === "heading" && block.level === 2 ? [block.text] : [])));
    case "commands": return Array.isArray(source) ? [] : sections_from_titles(source.groups.map((group) => group.name));
    case "search-engines": return [];
    case "styling": return STYLING_SECTIONS;
  }
}

function section_heading(page: PageId, section: Section): HTMLElement {
  const heading = el("h2", undefined, section.title);
  heading.id = section_anchor(page, section.slug);
  heading.tabIndex = -1;
  return heading;
}

export const section_hash = (page: PageId, slug: string): string => `#section=${page}/${encodeURIComponent(slug)}`;

function section_list(page: PageId, sections: Section[], expanded: boolean): HTMLElement {
  const list = el("div", "oasisfox-help-sections");
  list.id = `oasisfox-help-sections-${page}`;
  list.hidden = !expanded;
  for (const { title, slug } of sections) {
    const link = el("a", undefined, title);
    const hash = section_hash(page, slug);
    link.setAttribute("href", hash);
    // The same hash fires no hashchange, so a click would not scroll back from where the reader moved.
    link.addEventListener("click", () => {
      if (decodeURIComponent(location.hash) !== decodeURIComponent(hash)) return;
      const heading = document.getElementById(section_anchor(page, slug));
      heading?.scrollIntoView();
      heading?.focus({ preventScroll: true });
    });
    list.append(link);
  }
  return list;
}

// Kept outside the tree, like any state a render would wipe: a group the reader opened or closed stays that way across renders.
const group_open = new Map<PageId, boolean>();
let last_page: PageId | undefined;

export function reset_group_state(): void {
  group_open.clear();
  last_page = undefined;
}

// A real button, so keys and hints reach it.
function section_toggle(page: PageId, title: string, list: HTMLElement): HTMLElement {
  const button = el("button", "oasisfox-help-sections-toggle", list.hidden ? "\u25B8" : "\u25BE");
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", `${title} sections`);
  button.setAttribute("aria-controls", list.id);
  button.setAttribute("aria-expanded", String(!list.hidden));
  button.addEventListener("click", () => {
    list.hidden = !list.hidden;
    group_open.set(page, !list.hidden);
    button.setAttribute("aria-expanded", String(!list.hidden));
    button.textContent = list.hidden ? "\u25B8" : "\u25BE";
  });
  return button;
}

// Going to a page opens its group. Other groups keep what the reader set, closed at first. Each toggle works alone.
function sidebar(current: PageId, model: HelpModel): HTMLElement {
  if (current !== last_page) group_open.set(current, true);
  last_page = current;
  const entries = PAGES.map((page): HTMLElement => {
    const link = el("a", undefined, page.title);
    link.setAttribute("href", page.hash);
    if (page.id === current) link.setAttribute("aria-current", "page");
    const sections = page_sections(page.id, model);
    if (sections.length === 0) return link;
    const list = section_list(page.id, sections, group_open.get(page.id) ?? false);
    return el("div", "oasisfox-help-nav-group", el("div", "oasisfox-help-nav-row", link, section_toggle(page.id, page.title, list)), list);
  });
  return el("nav", "oasisfox-help-sidebar", el("div", "oasisfox-help-brand", "OasisFox"), ...entries, support_line());
}

export function render_help(root: HTMLElement, model: HelpModel, route: Route, guide: Block[]): void {
  const title = PAGES.find((page) => page.id === route.page)?.title ?? "Home";
  const heading = el("h1", undefined, title);
  heading.tabIndex = -1;
  const page = el("main", "oasisfox-help-page", heading, ...page_body(route, model, guide));
  root.replaceChildren(el("div", "oasisfox-help", sidebar(route.page, model), page));
}
