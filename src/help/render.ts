// Draws the help model with DOM calls only. Command text never goes through innerHTML.

import type { Block } from "./blocks.ts";
import type { RuleColumn, KeyChange, SiteRuleRowView } from "../background/site_rules_view.ts";
import type { CommandRow, EngineRow, HelpModel, KeyRow } from "./model.ts";
import { advanced_count, STYLE_CLASSES, STYLE_VARIABLES, visible_commands_model } from "./model.ts";
import { menu_icon } from "../shared/icons.ts";
import { key_caps } from "../shared/key_caps.ts";
import { grant_hash } from "../shared/permission_grant.ts";
import { GROUPS } from "./settings_model.ts";
import { practice_page } from "./practice_page.ts";
import { ADVANCED_SUFFIX, PAGES } from "../shared/page/help_route.ts";
import type { PageId, Route } from "../shared/page/help_route.ts";
import { code_block_node, el, inline_node, new_tab_link, table_of } from "./dom.ts";
import type { Child } from "./dom.ts";
import { ADVANCED_BACKUP_SECTION, ADVANCED_FILES_EDITOR_SECTION, ADVANCED_FILES_SECTION, ALIASES_SECTION, ENGINES_SECTION, GUIDE_SUBSECTION_LEVEL, KEYS_SECTION, QUICKMARKS_SECTION, SITE_RULES_SECTION, STYLING_SECTIONS, page_sections, section_anchor, section_heading, section_hash, settings_section } from "./sections.ts";
import type { Section } from "./sections.ts";
import { ONLY_CHANGED_CLASS, SIDEBAR_ID, follow_current_section, sidebar, wire_drawer } from "./sidebar.ts";

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

function only_changed_toggle(): HTMLElement {
  const box = el("input", undefined) as HTMLInputElement;
  box.type = "checkbox";
  box.className = "desertfox-only-changed-toggle";
  box.addEventListener("change", () => document.querySelector(".desertfox-settings")?.classList.toggle(ONLY_CHANGED_CLASS, box.checked));
  return el("p", undefined, el("label", undefined, box, " Show only changed settings"));
}


const SITE_RULES_DOC_URL = "https://github.com/uhs-robert/desertfox/blob/main/docs/site_rows.md#write-your-own-rule";

function edit_rules_link(): HTMLElement {
  const link = el("a", undefined, "Edit rules");
  link.setAttribute("href", edit_files_hash());
  return link;
}

// The box is a settings row, so the changed-only filter treats it like any other row.
function site_rules_section(): HTMLElement {
  const box = el("div", "desertfox-settings-row desertfox-site-rules");
  box.setAttribute("data-setting", "site_rules");
  return el(
    "div",
    "desertfox-settings-section",
    section_heading("settings", settings_section(SITE_RULES_SECTION)),
    el("p", undefined, edit_rules_link()),
    el("p", "desertfox-help-muted", "Each rule names the sites it covers and what DesertFox does there, for example turns its keys off or gives some keys to the page. The first rule that matches a page and sets a field decides that field. ", new_tab_link("Read how to write a rule", SITE_RULES_DOC_URL), "."),
    box,
    // `main.ts` fills `.desertfox-site-keys`.
    el("div", "desertfox-site-keys"),
  );
}

function settings_group_section(page_section: Section, group: (typeof GROUPS)[number]): HTMLElement {
  const box = el("div", "desertfox-settings-group");
  box.setAttribute("data-group", group.title);
  const intro = el("p", "desertfox-help-muted", group.intro, ...(group.title === "Appearance" ? [" For full control with CSS, see ", page_link("Styling", "styling"), "."] : []));
  // `main.ts` fills `.desertfox-themes`.
  const importer = group.title === "Appearance" ? [el("h4", undefined, "Import a theme"), el("p", "desertfox-help-muted", "Bring in a base16 or base24 color scheme. Paste its text or choose its file, check the preview, then save it. Save adds it to your config files as themes/<name>.toml. Use it with the theme setting above, or with :set theme and its name."), el("p", "desertfox-help-muted", "Find schemes in the ", new_tab_link("base16", "https://github.com/tinted-theming/schemes/tree/spec-0.11/base16"), " and ", new_tab_link("base24", "https://github.com/tinted-theming/schemes/tree/spec-0.11/base24"), " collections, or browse them in the ", new_tab_link("gallery", "https://tinted-theming.github.io/tinted-gallery/"), ". Open a scheme file, copy its text and paste it here."), el("div", "desertfox-themes")] : [];
  return el("div", "desertfox-settings-section", section_heading("settings", page_section), intro, box, ...importer);
}


// Where the site rules table sends the reader to edit: the files editor in the collapsed Advanced block, which a section link opens.
const edit_files_hash = (): string => section_hash("settings", settings_section(ADVANCED_FILES_EDITOR_SECTION).slug);

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
    el("p", undefined, "Change how DesertFox looks and behaves. Each change is saved as soon as you make it. Press Reset to drop your browser changes. For a setting kept in settings.toml, Reset also removes it there. A value set in a settings.d file stays. Change it in that file."),
    only_changed_toggle(),
    el(
      "div",
      "desertfox-settings",
      el("p", `desertfox-help-muted ${NO_CHANGED_CLASS}`, "You have not changed any setting yet."),
      ...GROUPS.map((group) => settings_group_section(settings_section(group.title), group)),
      site_rules_section(),
    ),
    // `main.ts` fills `.desertfox-keys`, `.desertfox-engines`, `.desertfox-aliases` and `.desertfox-quickmarks`.
    ...settings_form_section(KEYS_SECTION, "desertfox-keys", "Change what a key does. Pick a key below, press the new keys and type the command it runs. The change works at once."),
    ...settings_form_section(ENGINES_SECTION, "desertfox-engines", "Add a site you can search from the keyboard. Give it a name and an address with ", el("code", undefined, "{query}"), " where the search words go. A key letter lets you search it with ", el("code", undefined, "s"), " and that letter, or in a new tab with ", el("code", undefined, "S"), " and that letter. A search word is optional. Type it before your words in the Find anything box (press ", el("code", undefined, model.keys.find_anything), ") to search that engine, for example w rust. DesertFox saves the engines you add here. When it reads your config folder, it also writes them to ", el("code", undefined, "search_engines.d/zz-desertfox.toml"), " there, and their key letters to ", el("code", undefined, "keymap.d/zz-desertfox.toml"), ". Engines and keys in your other files stay as you wrote them."),
    ...settings_form_section(ALIASES_SECTION, "desertfox-aliases", "Give a command a short name. Type the short name in the command line to run the command. For example, the alias ", el("code", undefined, "up"), " can run ", el("code", undefined, "tab.prev"), ". Find command names on the ", page_link("Commands", "commands"), " page."),
    ...settings_form_section(QUICKMARKS_SECTION, "desertfox-quickmarks", "A quickmark is a site saved under one letter or digit. Open it from the keyboard with the quickmark key and then the letter. Add one here, or save the page you are on."),
    advanced_settings(model),
  ];
}

// Columns are name and value pairs, so a per-site setting added later shows with no code here.
const columns_table = (columns: RuleColumn[]): HTMLElement => table_of("desertfox-help-columns", ["option", "value", ""], columns.map(({ name, value, shadowed }) => [name, value, shadowed ? "an earlier rule decides this" : ""]), columns.map(({ shadowed }) => shadowed));
const changes_table = (changes: KeyChange[]): HTMLElement =>
  table_of("desertfox-help-changes", ["key", "mode", "does", "was", ""], changes.map(({ keys, mode, keymap_mode, action, replaces, dead }) => [el("kbd", undefined, keys), mode ?? (keymap_mode === undefined ? "" : `keymap ${keymap_mode}`), action, replaces ?? "", dead ?? ""]), changes.map(({ dead }) => dead !== undefined));

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
