// Draws the help model with DOM calls only. Command text never goes through innerHTML.

import { copy_text } from "../content/caret/copy_text.ts";
import type { Block, Inline } from "./blocks.ts";
import type { RuleColumn, KeyChange, SiteRuleRowView } from "../background/site_rules_view.ts";
import type { CommandRow, EngineRow, HelpModel, KeyRow } from "./model.ts";
import { advanced_count, group_title, STYLE_CLASSES, STYLE_VARIABLES, visible_commands_model } from "./model.ts";
import { chevron_icon, heart_icon, menu_icon } from "../shared/icons.ts";
import { key_caps } from "../shared/key_caps.ts";
import { grant_hash } from "../shared/permission_grant.ts";
import { GROUPS } from "./settings_model.ts";
import { ADVANCED_SUFFIX, PAGES } from "./route.ts";
import type { PageId, Route } from "./route.ts";

export type Child = Node | string;

export function el(tag: string, class_name: string | undefined, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  if (class_name) node.className = class_name;
  node.append(...children);
  return node;
}

function key_list(rows: KeyRow[]): HTMLElement {
  const cell = el("div", "desertfox-help-keys");
  if (rows.length === 0) {
    const none = el("span", "desertfox-help-muted", "-");
    none.setAttribute("aria-label", "no keys");
    cell.append(none);
    return cell;
  }
  for (const row of rows) {
    const line = el("div", "desertfox-help-key-line", el("span", "desertfox-help-mode", row.mode), key_caps(row.keys));
    if (row.args) line.append(" ", el("span", "desertfox-help-muted", row.args));
    cell.append(line);
  }
  return cell;
}

function params_table(command: CommandRow): HTMLElement | string {
  if (command.params.length === 0) return el("span", "desertfox-help-muted", "no options");
  const head = el("tr", undefined, ...["option", "type", "default", "values", "flags"].map((name) => el("th", undefined, name)));
  const body = command.params.map((param) =>
    el("tr", undefined, ...[param.name, param.type, param.default, param.values, param.flags].map((text) => el("td", undefined, text))),
  );
  return el("table", "desertfox-help-params", head, ...body);
}

const page_hash = (id: PageId): string => PAGES.find((page) => page.id === id)!.hash;

function page_link(text: string, id: PageId): HTMLElement {
  const link = el("a", undefined, text);
  link.setAttribute("href", page_hash(id));
  return link;
}

export const command_anchor = (id: string): string => `command-${id}`;

// The card color cycles over the groups, so a reader sees where one group ends. The stylesheet maps the number to a role color.
const GROUP_ACCENTS = 5;

function command_card(command: CommandRow, group_index: number): HTMLElement {
  const card = el(
    "section",
    "desertfox-help-command",
    el("div", "desertfox-help-command-head", el("h3", undefined, command.label, " ", el("code", "desertfox-help-muted", command.id)), key_list(command.keys)),
    el("p", undefined, command.intent),
    el("pre", "desertfox-help-usage", command.usage),
    params_table(command),
  );
  card.id = command_anchor(command.id);
  card.setAttribute("data-accent", String(group_index % GROUP_ACCENTS));
  return card;
}

export const engine_anchor = (name: string): string => `engine-${name}`;

const file_name = (path: string): string => path.split("/").pop() ?? path;

function engine_row(engine: EngineRow, show_files: boolean): HTMLElement {
  const name = el("td", undefined, engine.name);
  if (engine.needs) name.append(" ", el("span", "desertfox-help-badge", `needs ${engine.needs}`));
  if (engine.fallback) name.append(" ", el("span", "desertfox-help-badge", `falls back to ${engine.fallback}`));
  if (show_files) {
    for (const file of engine.files) {
      const badge = el("span", "desertfox-help-badge", file_name(file));
      badge.title = file;
      name.append(" ", badge);
    }
  }
  const keys = el("td", undefined, ...engine.keys.flatMap((sequence) => [el("kbd", undefined, sequence), " "]));
  const host = el("summary", undefined, engine.host);
  host.title = engine.url;
  const full = el("div", "desertfox-help-muted", engine.url, ...engine.origins.map((line) => el("div", undefined, line)));
  const row = el("tr", undefined, name, el("td", undefined, engine.label), keys, el("td", undefined, el("details", undefined, host, full)));
  row.id = engine_anchor(engine.name);
  return row;
}

function engine_table(engines: EngineRow[]): HTMLElement {
  if (engines.length === 0) return el("p", "desertfox-help-muted", "No engines yet. Add one on the ", page_link("Settings", "settings"), " page.");
  const first_file = engines[0]!.files[0];
  const one_file = first_file !== undefined && engines.every((engine) => engine.files.length === 1 && engine.files[0] === first_file);
  const head = el("tr", undefined, ...["Name", "What it searches", "Keys", "Address"].map((name) => el("th", undefined, name)));
  const table = el("table", "desertfox-help-engines", head, ...engines.map((engine) => engine_row(engine, !one_file)));
  if (!one_file) return table;
  return el("div", undefined, el("p", "desertfox-help-muted", `Set by the file ${first_file}`), table);
}

function inline_node(inline: Inline): Child {
  switch (inline.kind) {
    case "text": return inline.text;
    case "code": return el("code", "desertfox-help-inline-code", inline.text);
    case "keys": return key_caps(inline.text);
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
  const button = el("button", "desertfox-help-code-copy", "Copy");
  button.setAttribute("type", "button");
  button.addEventListener("click", () => void copy_code_and_confirm(navigator.clipboard, text, button));
  const head = el("div", "desertfox-help-code-head", ...(language ? [el("span", "desertfox-help-code-lang", language)] : []), button);
  return el("div", "desertfox-help-code", head, el("pre", "desertfox-help-code-body", text));
}

function block_node(block: Block): HTMLElement {
  switch (block.kind) {
    case "heading": return el(`h${block.level}`, undefined, block.text);
    case "paragraph": return el("p", undefined, ...block.inlines.map(inline_node));
    case "tip": return el("div", "desertfox-help-tip", el("strong", "desertfox-help-tip-label", "Tip"), ": ", ...block.inlines.map(inline_node));
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

const GUIDE_SUBSECTION_LEVEL = 3;
const YOUR_ENGINES = "Your engines";

// The guide's level-3 headings and the engines table are the Search Engines sections. The sole level-2 heading in the guide is a wrapper, so it gets no entry.
function search_engines_page(guide: Block[], model: HelpModel): HTMLElement[] {
  const sections = [...page_sections("search-engines", model, guide)];
  const body = guide.map((block) => {
    if (block.kind !== "heading" || block.level !== GUIDE_SUBSECTION_LEVEL) return block_node(block);
    return section_heading("search-engines", sections.shift()!, GUIDE_SUBSECTION_LEVEL);
  });
  return [...body, section_heading("search-engines", sections.shift()!), engine_table(model.engines)];
}

function definition_table(rows: { name: string; meaning: string }[]): HTMLElement {
  return el("table", undefined, ...rows.map((row) => el("tr", undefined, el("td", undefined, el("code", undefined, row.name)), el("td", undefined, row.meaning))));
}

function home_keycap(): HTMLElement {
  const keycap = document.createElement("img");
  keycap.className = "desertfox-help-keycap";
  keycap.setAttribute("src", "icons/desertfox-keycap.svg");
  keycap.setAttribute("alt", "");
  return keycap;
}

function home_page(model: HelpModel): HTMLElement[] {
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

// The toggle lives in the hash, so a reload, a link and the back button keep it. It shows the count, which the shown model no longer holds.
function advanced_toggle(advanced: boolean, count: number): HTMLElement {
  const button = el("button", "desertfox-help-advanced-toggle", advanced ? "Hide advanced commands" : `Show advanced commands (${count})`) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("aria-pressed", String(advanced));
  button.addEventListener("click", () => {
    location.hash = PAGES.find((page) => page.id === "commands")!.hash + (advanced ? "" : ADVANCED_SUFFIX);
  });
  return el("p", undefined, button, " ", el("span", "desertfox-help-muted", "Advanced commands are for setup and debugging."));
}

function commands_page(model: HelpModel, advanced: boolean, hidden_count: number): HTMLElement[] {
  const sections = page_sections("commands", model);
  return [
    el("p", undefined, "Every command DesertFox has. Run a command from the command line or with a key. Search this page with the browser's find (Ctrl+F)."),
    block_node(model.tip),
    ...(hidden_count > 0 || advanced ? [advanced_toggle(advanced, hidden_count)] : []),
    ...model.groups.flatMap((group, index) => [section_heading("commands", sections[index]!), ...group.commands.map((command) => command_card(command, index))]),
  ];
}

function styling_page(): HTMLElement[] {
  const [variables_section, classes_section] = STYLING_SECTIONS as [Section, Section];
  return [
    el("p", undefined, "You can change how DesertFox looks with CSS. Put your rules in a file named style.css in your settings files, or in the files editor on the ", page_link("Settings", "settings"), " page. Set a variable on the class of the part you want to restyle, for example .desertfox-whichkey { --desertfox-primary: red; }. A variable on :root or :host alone does not reach inside a part. A part reads only the colors it needs, so a color no part reads yet has no visible effect. The class names below are stable."),
    section_heading("styling", variables_section),
    definition_table(STYLE_VARIABLES),
    section_heading("styling", classes_section),
    definition_table(STYLE_CLASSES.map((entry) => ({ ...entry, name: `.${entry.name}` }))),
  ];
}

// Opens the panel `:native.install` opens, by the same hash. The nonce makes a tab already on the panel show it again.
function install_native_host_button(): HTMLElement {
  const button = el("button", "desertfox-settings-install", "Set up the native host") as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", () => {
    location.hash = grant_hash("nativeMessaging", Date.now());
  });
  return el("p", undefined, button);
}

const CONFIG_SOURCE_CLASS = "desertfox-config-source";
const config_source_text = (model: HelpModel): string => `${model.config_source}.`;

// The Settings page is not redrawn on a settings change, so a reload that changes the source updates this line in place and leaves the fields alone.
export function update_config_source(model: HelpModel): void {
  const line = document.querySelector(`.${CONFIG_SOURCE_CLASS}`);
  if (line) line.textContent = config_source_text(model);
}

const NO_CHANGED_CLASS = "desertfox-settings-none-changed";
const ONLY_CHANGED_CLASS = "desertfox-only-changed";

// The filter is a class on the settings box. The stylesheet (home.html) hides the rows whose `data-changed` is false and the groups left with none, so a refresh of the rows needs no code here.
function clear_only_changed(): void {
  document.querySelector(".desertfox-settings")?.classList.toggle(ONLY_CHANGED_CLASS, false);
  const box = document.querySelector<HTMLInputElement>(".desertfox-only-changed-toggle");
  if (box) box.checked = false;
}

function only_changed_toggle(): HTMLElement {
  const box = el("input", undefined) as HTMLInputElement;
  box.type = "checkbox";
  box.className = "desertfox-only-changed-toggle";
  box.addEventListener("change", () => document.querySelector(".desertfox-settings")?.classList.toggle(ONLY_CHANGED_CLASS, box.checked));
  return el("p", undefined, el("label", undefined, box, " Show only changed settings"));
}

function settings_group_section(page_section: Section, group: (typeof GROUPS)[number]): HTMLElement {
  const box = el("div", "desertfox-settings-group");
  box.setAttribute("data-group", group.title);
  const intro = el("p", "desertfox-help-muted", group.intro, ...(group.title === "Appearance" ? [" For full control with CSS, see ", page_link("Styling", "styling"), "."] : []));
  return el("div", "desertfox-settings-section", section_heading("settings", page_section), intro, box);
}

const settings_section = (title: string): Section => settings_sections[SETTINGS_SECTION_TITLES.indexOf(title)]!;

// A form section: its heading, one sentence of what it gives the reader, and the box `main.ts` fills.
function settings_form_section(title: string, box_class: string, ...intro: Child[]): HTMLElement[] {
  return [section_heading("settings", settings_section(title)), el("p", undefined, ...intro), el("div", box_class)];
}

// Collapsed, because a new reader needs none of it. A section link into it opens it (`main.ts`).
function advanced_settings(model: HelpModel): HTMLElement {
  return el(
    "details",
    "desertfox-settings-advanced",
    el("summary", undefined, "Advanced"),
    section_heading("settings", settings_section(ADVANCED_FILES_SECTION), 3),
    el("p", undefined, "You can also keep your settings in text files in the folder ", el("code", undefined, "~/.config/desertfox/"), ". This needs the native host, a small helper program DesertFox installs on Linux. It reads that folder for DesertFox."),
    el("p", CONFIG_SOURCE_CLASS, config_source_text(model)),
    el("ol", undefined, ...model.rebuild_steps.map((step) => el("li", undefined, step))),
    install_native_host_button(),
    section_heading("settings", settings_section(ADVANCED_BACKUP_SECTION), 3),
    el("p", undefined, "Back up your DesertFox setup to a file, or restore it from one. An import replaces your current setup and keeps the snippets you installed. A snippet is a small script that runs on the sites you choose. DesertFox asks before it adds any snippet an import carries."),
    el("div", "desertfox-transfer"),
    section_heading("settings", settings_section(ADVANCED_FILES_EDITOR_SECTION), 3),
    el("p", undefined, "Edit your setup files here. A file is saved only if the setup still builds. If it does not build, nothing changes. Paste only text you trust, because DesertFox does not check it. With the native host set up, a start that finds different files in the folder asks before it replaces these."),
    el("div", "desertfox-files"),
  );
}

// Settings go in after the render: `main.ts` fills `.desertfox-settings` from the background.
function settings_page(model: HelpModel): HTMLElement[] {
  return [
    // Empty unless a host start waits on the user: `main.ts` fills it.
    el("div", "desertfox-host-start"),
    el("p", undefined, "Change how DesertFox looks and behaves. Each change is saved as soon as you make it. Press Reset to undo a change."),
    only_changed_toggle(),
    el(
      "div",
      "desertfox-settings",
      el("p", `desertfox-help-muted ${NO_CHANGED_CLASS}`, "You have not changed any setting yet."),
      ...GROUPS.map((group) => settings_group_section(settings_section(group.title), group)),
    ),
    // `main.ts` fills `.desertfox-keys`, `.desertfox-engines`, `.desertfox-aliases` and `.desertfox-quickmarks`.
    ...settings_form_section(KEYS_SECTION, "desertfox-keys", "Change what a key does. Pick a key below, press the new keys and type the command it runs. The change works at once."),
    ...settings_form_section(ENGINES_SECTION, "desertfox-engines", "Add a site you can search from the keyboard. Give it a name and an address with ", el("code", undefined, "{query}"), " where the search words go. A key letter lets you search it with ", el("code", undefined, "s"), " and that letter, or in a new tab with ", el("code", undefined, "S"), " and that letter. A search word is optional. Type it before your words in the Find anything box (press ", el("code", undefined, model.keys.find_anything), ") to search that engine, for example w rust."),
    ...settings_form_section(ALIASES_SECTION, "desertfox-aliases", "Give a command a short name. Type the short name in the command line to run the command. For example, the alias ", el("code", undefined, "up"), " can run ", el("code", undefined, "tab.prev"), ". Find command names on the ", page_link("Commands", "commands"), " page."),
    ...settings_form_section(QUICKMARKS_SECTION, "desertfox-quickmarks", "A quickmark is a site saved under one letter or digit. Open it from the keyboard with the quickmark key and then the letter. Add one here, or save the page you are on."),
    advanced_settings(model),
  ];
}

const SHADOWED_CLASS = "desertfox-help-shadowed";
const table_of = (class_name: string, heads: string[], rows: (HTMLElement | string)[][], shadowed: boolean[]): HTMLElement =>
  el("table", `desertfox-help-site-rules ${class_name}`, el("tr", undefined, ...heads.map((name) => el("th", undefined, name))), ...rows.map((cells, index) => el("tr", shadowed[index] ? SHADOWED_CLASS : undefined, ...cells.map((cell) => el("td", undefined, cell)))));

// Columns are name and value pairs, so a per-site setting added later shows with no code here.
const columns_table = (columns: RuleColumn[]): HTMLElement => table_of("desertfox-help-columns", ["option", "value", ""], columns.map(({ name, value, shadowed }) => [name, value, shadowed ? "an earlier rule decides this" : ""]), columns.map(({ shadowed }) => shadowed));
const changes_table = (changes: KeyChange[]): HTMLElement =>
  table_of("desertfox-help-changes", ["key", "mode", "does", "was", ""], changes.map(({ keys, mode, action, replaces, dead }) => [el("kbd", undefined, keys), mode ?? "", action, replaces ?? "", dead ?? ""]), changes.map(({ dead }) => dead !== undefined));

function site_rule_row(row: SiteRuleRowView): HTMLElement {
  const source = row.origin === "default" ? `Built-in rule ${row.name}` : "Your rule";
  return el("section", "desertfox-help-command", el("h3", undefined, source, " ", el("code", "desertfox-help-muted", row.site)), row.columns.length > 0 ? columns_table(row.columns) : el("p", "desertfox-help-muted", "This rule sets no option."), row.changes.length > 0 ? changes_table(row.changes) : "");
}

// The list is for the tab's own address. A frame of another site resolves its rows against its own address, so it can differ.
function site_rules_page(model: HelpModel, address: string | undefined): HTMLElement[] {
  if (address === undefined) return [el("p", undefined, "Site rules change how DesertFox works on certain sites, for example by turning keys off. Open a web page, then run ", el("code", undefined, ":help site_rules"), " to see the rules that apply to it.")];
  const { rows } = model.site_rules_for(address);
  return [
    el("p", undefined, "These rules apply to ", el("code", undefined, address), ". If two rules set the same option, the first one wins. A key rule wins key by key. Frames from other sites follow the rules for their own address, so this list is for the tab's address only."),
    ...(rows.length === 0 ? [el("p", undefined, "No rule applies to this address.")] : rows.map(site_rule_row)),
  ];
}

function page_body(route: Route, model: HelpModel, guide: Block[], advanced_total: number): HTMLElement[] {
  switch (route.page) {
    case "home": return home_page(model);
    case "settings": return settings_page(model);
    case "quick-start": return quick_start_page(model.quick_start);
    case "search-engines": return search_engines_page(guide, model);
    case "commands": return commands_page(model, route.advanced === true, advanced_total);
    case "styling": return styling_page();
    case "site-rules": return site_rules_page(model, route.address);
  }
}

function support_link(title: string, url: string): HTMLElement {
  const link = el("a", "desertfox-help-support-link", title);
  link.setAttribute("href", url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  return link;
}

function support_card(): HTMLElement {
  const heading = el("div", "desertfox-help-support-heading", heart_icon("desertfox-help-support-heart"), "Enjoying DesertFox?");
  return el(
    "div",
    "desertfox-help-support",
    heading,
    el("div", "desertfox-help-support-note", "Support its work"),
    support_link("GitHub Sponsors", "https://github.com/sponsors/uhs-robert"),
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

const KEYS_SECTION = "Keys";
const ENGINES_SECTION = "Search engines";
const ALIASES_SECTION = "Aliases";
const QUICKMARKS_SECTION = "Quickmarks";
const ADVANCED_FILES_SECTION = "Advanced: settings files";
const ADVANCED_BACKUP_SECTION = "Advanced: back up and restore";
const ADVANCED_FILES_EDITOR_SECTION = "Advanced: edit files";
// The setting groups come first, then the forms, then the collapsed Advanced block.
const SETTINGS_SECTION_TITLES = [...GROUPS.map((group) => group.title), KEYS_SECTION, ENGINES_SECTION, ALIASES_SECTION, QUICKMARKS_SECTION, ADVANCED_FILES_SECTION, ADVANCED_BACKUP_SECTION, ADVANCED_FILES_EDITOR_SECTION];
const settings_sections = sections_from_titles(SETTINGS_SECTION_TITLES);
const STYLING_SECTIONS = sections_from_titles(["Variables", "Classes"]);

// The sections a page lists in the sidebar. Only Search Engines reads the guide.
export function page_sections(page: PageId, source: HelpModel | Block[], guide: Block[] = []): Section[] {
  const quick_start = Array.isArray(source) ? source : source.quick_start;
  switch (page) {
    case "home": return [];
    case "settings": return settings_sections;
    case "quick-start": return sections_from_titles(quick_start.flatMap((block) => (block.kind === "heading" && block.level === 2 ? [block.text] : [])));
    // The slug comes from the id part, so a link to a group keeps working. Only the shown title is plain.
    case "commands": return Array.isArray(source) ? [] : sections_from_titles(source.groups.map((group) => group.name)).map((section, index) => ({ ...section, title: group_title(source.groups[index]!.name) }));
    case "search-engines": return sections_from_titles([...guide.flatMap((block) => (block.kind === "heading" && block.level === GUIDE_SUBSECTION_LEVEL ? [block.text] : [])), YOUR_ENGINES]);
    case "styling": return STYLING_SECTIONS;
    case "site-rules": return [];
  }
}

function section_heading(page: PageId, section: Section, level = 2): HTMLElement {
  const heading = el(`h${level}`, undefined, section.title);
  heading.id = section_anchor(page, section.slug);
  heading.tabIndex = -1;
  return heading;
}

export const section_hash = (page: PageId, slug: string): string => `#section=${page}/${encodeURIComponent(slug)}`;

// The section links of the current render with the id of the heading each one names, for the "you are here" mark.
type SectionLink = { link: HTMLElement; heading_id: string };
let section_links: SectionLink[] = [];

// The link of the section the reader is in gets aria-current="location". That is the last heading at or above `line`, or the last heading of all once the page is scrolled to its end, where a short last section never reaches the line.
// `top_of` gives a heading's distance from the viewport top, or undefined when it is not on the page or hidden.
export function mark_current_section(entries: SectionLink[], top_of: (heading_id: string) => number | undefined, line: number, at_end: boolean): void {
  const placed = entries.flatMap((entry) => {
    const top = top_of(entry.heading_id);
    return top === undefined ? [] : [{ entry, top }];
  });
  const above = placed.filter(({ top }) => top <= line);
  const current = at_end && placed.length > 0 ? placed.reduce((a, b) => (b.top >= a.top ? b : a)) : above.reduce<(typeof placed)[number] | undefined>((a, b) => (a === undefined || b.top >= a.top ? b : a), undefined);
  for (const entry of entries) {
    if (entry === current?.entry) entry.link.setAttribute("aria-current", "location");
    else entry.link.removeAttribute("aria-current");
  }
}

const CURRENT_LINE_FRACTION = 0.3;
let mark_queued = false;

// One scroll listener for the whole page, throttled to one run per frame. It reads the links of the latest render, so a redraw needs no new listener.
function queue_current_section(): void {
  if (mark_queued || typeof requestAnimationFrame !== "function") return;
  mark_queued = true;
  requestAnimationFrame(() => {
    mark_queued = false;
    const top_of = (id: string) => {
      const heading = document.getElementById(id);
      return heading && heading.getClientRects().length > 0 ? heading.getBoundingClientRect().top : undefined;
    };
    const root = document.documentElement;
    mark_current_section(section_links, top_of, window.innerHeight * CURRENT_LINE_FRACTION, window.scrollY + window.innerHeight >= root.scrollHeight - 2);
    keep_current_link_visible();
  });
}

// The sidebar scrolls on its own, so a long list can hide the current link. Only the sidebar moves, never the page.
function keep_current_link_visible(): void {
  const bar = document.querySelector<HTMLElement>(`#${SIDEBAR_ID}`);
  const link = bar?.querySelector<HTMLElement>('.desertfox-help-sections a[aria-current="location"]');
  if (!bar || !link || link.getClientRects().length === 0) return;
  const bar_box = bar.getBoundingClientRect();
  const link_box = link.getBoundingClientRect();
  if (link_box.top < bar_box.top) bar.scrollTop += link_box.top - bar_box.top;
  else if (link_box.bottom > bar_box.bottom) bar.scrollTop += link_box.bottom - bar_box.bottom;
}

let scroll_listener_added = false;
function follow_scroll_for_current_section(): void {
  if (!scroll_listener_added && typeof window !== "undefined" && window.addEventListener) {
    scroll_listener_added = true;
    window.addEventListener("scroll", queue_current_section, { passive: true });
  }
  queue_current_section();
}

function section_list(page: PageId, sections: Section[], expanded: boolean, keep_advanced = false): HTMLElement {
  const list = el("div", "desertfox-help-sections");
  list.id = `desertfox-help-sections-${page}`;
  list.hidden = !expanded;
  for (const { title, slug } of sections) {
    const link = el("a", undefined, title);
    const hash = section_hash(page, slug) + (keep_advanced ? ADVANCED_SUFFIX : "");
    link.setAttribute("href", hash);
    section_links.push({ link, heading_id: section_anchor(page, slug) });
    // The same hash fires no hashchange, so a click would not scroll back from where the reader moved.
    link.addEventListener("click", () => {
      // A group the filter hides has no heading to scroll to, so a link to a group shows every setting.
      if (page === "settings" && document.getElementById(section_anchor(page, slug))?.closest(".desertfox-settings-section")) clear_only_changed();
      if (decodeURIComponent(location.hash) !== decodeURIComponent(hash)) return;
      const heading = document.getElementById(section_anchor(page, slug));
      const collapsed = heading?.closest("details");
      if (collapsed) collapsed.open = true;
      heading?.scrollIntoView();
      heading?.focus({ preventScroll: true });
    });
    list.append(link);
  }
  return list;
}

// Kept outside the tree, like any state a render would wipe. Holds only chevron toggles, never the automatic opening of the current page.
const group_open = new Map<PageId, boolean>();
let last_page: PageId | undefined;

export function reset_group_state(): void {
  group_open.clear();
  last_page = undefined;
}

// A real button, so keys and hints reach it.
function section_toggle(page: PageId, title: string, list: HTMLElement): HTMLElement {
  const button = el("button", "desertfox-help-sections-toggle", chevron_icon());
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", `${title} sections`);
  button.setAttribute("aria-controls", list.id);
  button.setAttribute("aria-expanded", String(!list.hidden));
  button.addEventListener("click", () => {
    list.hidden = !list.hidden;
    group_open.set(page, !list.hidden);
    button.setAttribute("aria-expanded", String(!list.hidden));
  });
  return button;
}

// The logo is the packaged icon, reached by a path relative to home.html, which the build copies to the package root.
function brand(): HTMLElement {
  const logo = document.createElement("img");
  logo.className = "desertfox-help-logo";
  logo.setAttribute("src", "icons/desertfox.svg");
  logo.setAttribute("alt", "");
  return el("div", "desertfox-help-brand", logo, "DesertFox");
}

// The current page's group is open unless the reader toggled it on this page. Going to a page drops its stored toggle, so a menu click always opens it. Other groups keep what the reader set, closed at first. Each toggle works alone.
function sidebar(current: PageId, model: HelpModel, guide: Block[], advanced: boolean): HTMLElement {
  if (current !== last_page) group_open.delete(current);
  last_page = current;
  const entries = PAGES.map((page): HTMLElement => {
    const link = el("a", undefined, page.title);
    link.setAttribute("href", page.hash);
    if (page.id === current) link.setAttribute("aria-current", "page");
    const sections = page_sections(page.id, model, guide);
    if (sections.length === 0) return link;
    const list = section_list(page.id, sections, group_open.get(page.id) ?? page.id === current, page.id === "commands" && advanced);
    const toggle = section_toggle(page.id, page.title, list);
    // A click on the current page's entry fires no hashchange and so no render, and a click from one of its sections renders on the same page. Neither reaches the reset above, so the click does it.
    link.addEventListener("click", () => {
      group_open.delete(page.id);
      list.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    });
    return el("div", "desertfox-help-nav-group", el("div", "desertfox-help-nav-row", link, toggle), list);
  });
  return el("nav", "desertfox-help-sidebar", brand(), ...entries, support_card());
}

const DRAWER_OPEN_CLASS = "desertfox-help-drawer-open";
const SIDEBAR_ID = "desertfox-help-sidebar";

function set_drawer_open(help: HTMLElement, open: boolean): void {
  help.classList.toggle(DRAWER_OPEN_CLASS, open);
  help.querySelector(".desertfox-help-menu-toggle")?.setAttribute("aria-expanded", String(open));
}

// Below the narrow breakpoint the sidebar is a drawer behind the menu button. Above it CSS hides the bar and the backdrop and ignores the open class.
// The drawer starts closed on every render, because each render follows a pick or a hash change. It lives in the DOM only, like the group toggles.
function wire_drawer(help: HTMLElement, menu_toggle: HTMLElement, sidebar_node: HTMLElement, backdrop: HTMLElement, page_heading: HTMLElement): void {
  const close = (focus_target: HTMLElement | null) => {
    set_drawer_open(help, false);
    focus_target?.focus({ preventScroll: true });
  };
  menu_toggle.addEventListener("click", () => {
    const open = !help.classList.contains(DRAWER_OPEN_CLASS);
    set_drawer_open(help, open);
    if (open) (sidebar_node.querySelector<HTMLElement>('a[aria-current="page"]') ?? sidebar_node.querySelector("a"))?.focus();
  });
  backdrop.addEventListener("click", () => close(menu_toggle));
  // A section link on the same hash already focused its heading. Any other pick leaves focus on a link that is about to hide, and a hash change moves it on again.
  sidebar_node.addEventListener("click", (event) => {
    if (!help.classList.contains(DRAWER_OPEN_CLASS) || !(event.target as Element).closest("a")) return;
    close(sidebar_node.contains(document.activeElement) ? page_heading : null);
  });
  // Tab past either end of the drawer closes it, so focus never sits under the backdrop. Past the last link into the browser's own UI no focusin fires, so main.ts also calls close_drawer_on_window_blur.
  help.addEventListener("focusin", (event) => {
    if (help.classList.contains(DRAWER_OPEN_CLASS) && !sidebar_node.contains(event.target as Node)) close(null);
  });
}

export function close_drawer_on_window_blur(): void {
  const help = document.querySelector<HTMLElement>(`.${DRAWER_OPEN_CLASS}`);
  if (help) set_drawer_open(help, false);
}

// main.ts listens in the capture phase before the content script loads, so Escape closes the drawer instead of reaching the key flow.
export function close_drawer_on_escape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const help = document.querySelector<HTMLElement>(`.${DRAWER_OPEN_CLASS}`);
  const menu_toggle = help?.querySelector<HTMLElement>(".desertfox-help-menu-toggle");
  if (!help || !menu_toggle) return;
  set_drawer_open(help, false);
  // A window widened past the breakpoint hides the button and shows no drawer, so Escape keeps its usual meaning there.
  if (menu_toggle.getClientRects().length === 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  menu_toggle.focus();
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
  section_links = [];
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
  follow_scroll_for_current_section();
}
