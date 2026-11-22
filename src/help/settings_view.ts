// The Settings page: the group sections, the form boxes `settings_boxes.ts` fills and the Advanced block.

import type { HelpModel } from "./model.ts";
import { grant_hash } from "../shared/permission_grant.ts";
import { GROUPS } from "./settings_model.ts";
import { el, new_tab_link, page_link } from "./dom.ts";
import type { Child } from "./dom.ts";
import { ADVANCED_BACKUP_SECTION, ADVANCED_FILES_EDITOR_SECTION, ADVANCED_FILES_SECTION, ALIASES_SECTION, ENGINES_SECTION, KEYS_SECTION, QUICKMARKS_SECTION, SITE_RULES_SECTION, section_heading, section_hash, settings_section } from "./sections.ts";
import type { Section } from "./sections.ts";
import { ONLY_CHANGED_CLASS } from "./sidebar.ts";
import { BOX_CLASS } from "./settings_boxes.ts";

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
    // `settings_boxes.ts` fills `.desertfox-site-keys`.
    el("div", BOX_CLASS.site_keys),
  );
}

function settings_group_section(page_section: Section, group: (typeof GROUPS)[number]): HTMLElement {
  const box = el("div", "desertfox-settings-group");
  box.setAttribute("data-group", group.title);
  const intro = el("p", "desertfox-help-muted", group.intro, ...(group.title === "Appearance" ? [" For full control with CSS, see ", page_link("Styling", "styling"), "."] : []));
  // `settings_boxes.ts` fills `.desertfox-themes`.
  const importer = group.title === "Appearance" ? [el("h4", undefined, "Import a theme"), el("p", "desertfox-help-muted", "Bring in a base16 or base24 color scheme. Paste its text or choose its file, check the preview, then save it. Save adds it to your config files as themes/<name>.toml. Use it with the theme setting above, or with :set theme and its name."), el("p", "desertfox-help-muted", "Find schemes in the ", new_tab_link("base16", "https://github.com/tinted-theming/schemes/tree/spec-0.11/base16"), " and ", new_tab_link("base24", "https://github.com/tinted-theming/schemes/tree/spec-0.11/base24"), " collections, or browse them in the ", new_tab_link("gallery", "https://tinted-theming.github.io/tinted-gallery/"), ". Open a scheme file, copy its text and paste it here."), el("div", BOX_CLASS.themes)] : [];
  return el("div", "desertfox-settings-section", section_heading("settings", page_section), intro, box, ...importer);
}


// Where the site rules table sends the reader to edit: the files editor in the collapsed Advanced block, which a section link opens.
const edit_files_hash = (): string => section_hash("settings", settings_section(ADVANCED_FILES_EDITOR_SECTION).slug);

// A form section: its heading, one sentence of what it gives the reader, and the box `settings_boxes.ts` fills.
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
    el("div", BOX_CLASS.transfer),
    section_heading("settings", settings_section(ADVANCED_FILES_EDITOR_SECTION), 3),
    el("p", undefined, "Edit your setup files here. A file is saved only if the setup still builds. If it does not build, nothing changes. Paste only text you trust, because DesertFox does not check it. With the native host set up, a start that finds different files in the folder asks before it replaces these."),
    el("div", BOX_CLASS.files),
  );
}

// Settings go in after the render: `settings_boxes.ts` fills `.desertfox-settings` from the background.
export function settings_page(model: HelpModel): HTMLElement[] {
  return [
    // Empty unless a host start waits on the user: `settings_boxes.ts` fills it.
    el("div", BOX_CLASS.host_start),
    el("p", undefined, "Change how DesertFox looks and behaves. Each change is saved as soon as you make it. Press Reset to drop your browser changes. For a setting kept in settings.toml, Reset also removes it there. A value set in a settings.d file stays. Change it in that file."),
    only_changed_toggle(),
    el(
      "div",
      BOX_CLASS.settings,
      el("p", `desertfox-help-muted ${NO_CHANGED_CLASS}`, "You have not changed any setting yet."),
      ...GROUPS.map((group) => settings_group_section(settings_section(group.title), group)),
      site_rules_section(),
    ),
    // `settings_boxes.ts` fills `.desertfox-keys`, `.desertfox-engines`, `.desertfox-aliases` and `.desertfox-quickmarks`.
    ...settings_form_section(KEYS_SECTION, BOX_CLASS.keys, "Change what a key does. Pick a key below, press the new keys and type the command it runs. The change works at once."),
    ...settings_form_section(ENGINES_SECTION, BOX_CLASS.engines, "Add a site you can search from the keyboard. Give it a name and an address with ", el("code", undefined, "{query}"), " where the search words go. A key letter lets you search it with ", el("code", undefined, "s"), " and that letter, or in a new tab with ", el("code", undefined, "S"), " and that letter. A search word is optional. Type it before your words in the Find anything box (press ", el("code", undefined, model.keys.find_anything), ") to search that engine, for example w rust. DesertFox saves the engines you add here. When it reads your config folder, it also writes them to ", el("code", undefined, "search_engines.d/zz-desertfox.toml"), " there, and their key letters to ", el("code", undefined, "keymap.d/zz-desertfox.toml"), ". Engines and keys in your other files stay as you wrote them."),
    ...settings_form_section(ALIASES_SECTION, BOX_CLASS.aliases, "Give a command a short name. Type the short name in the command line to run the command. For example, the alias ", el("code", undefined, "up"), " can run ", el("code", undefined, "tab.prev"), ". Find command names on the ", page_link("Commands", "commands"), " page."),
    ...settings_form_section(QUICKMARKS_SECTION, BOX_CLASS.quickmarks, "A quickmark is a site saved under one letter or digit. Open it from the keyboard with the quickmark key and then the letter. Add one here, or save the page you are on."),
    advanced_settings(model),
  ];
}
