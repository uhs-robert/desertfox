import { load_effective_config } from "../background/config_load.ts";
import { plan_help_tab } from "../background/open_help.ts";
import { WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { site_state } from "../background/toolbar.ts";
import type { SiteState } from "../background/toolbar.ts";
import { effective_settings } from "../shared/config.ts";
import type { ToolbarAnswer, ToolbarRequest } from "../shared/messages.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { follow_theme } from "../shared/theme/apply.ts";
import { DISABLED_STORAGE_KEY } from "../background/storage_keys.ts";
import { build_rows, disabled_after_click, site_card, HOME_HASH, SETTINGS_HASH, SITE_RULES_HASH, WARNINGS_HASH } from "./model.ts";
import type { PopupRow } from "./model.ts";

const root = document.getElementById("desertfox-popup")!;
let notice = "";

const ask = (request: ToolbarRequest): Promise<ToolbarAnswer> => browser.runtime.sendMessage(request) as Promise<ToolbarAnswer>;

async function active_tab(): Promise<browser.tabs.Tab | undefined> {
  return (await browser.tabs.query({ active: true, currentWindow: true }))[0];
}

async function read_site(url: string | undefined): Promise<SiteState> {
  const { config, edits, config_settings } = await load_effective_config();
  return site_state(url, {
    file: config_settings.site_rules ?? [],
    saved: edits.saved.site_rules,
    effective: effective_settings(config.settings).site_rules,
  });
}

async function open_help_page(hash: string): Promise<void> {
  const tab = await active_tab();
  const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
  const plan = plan_help_tab(help_page_url, help_page_url + hash, { id: tab?.id, window_id: tab?.windowId, url: tab?.url });
  if (plan.kind === "update") await browser.tabs.update(plan.tab_id, { url: plan.url });
  else await browser.tabs.create({ url: plan.url, ...(plan.opener ?? {}) });
  window.close();
}

async function act(row: PopupRow): Promise<void> {
  const tab = await active_tab();
  if (row.id === "power") notice = (await ask({ type: "toolbar_set_disabled", disabled: disabled_after_click(row) })).message;
  else if (row.id === "settings") return open_help_page(SETTINGS_HASH);
  else if (row.id === "home") return open_help_page(HOME_HASH);
  else if (row.id === "warnings") return open_help_page(WARNINGS_HASH);
  else if (row.id === "rule") return open_help_page(SITE_RULES_HASH);
  else if (row.id === "site") {
    const answer = await ask({ type: "toolbar_site", url: tab?.url ?? "", action: row.site_action ?? "disable" });
    notice = answer.message;
  } else if (row.id === "reload_config") notice = (await ask({ type: "toolbar_reload_config" })).message;
  await draw();
}

function element(tag: string, class_name: string, text?: string): HTMLElement {
  const made = document.createElement(tag);
  made.className = class_name;
  if (text !== undefined) made.textContent = text;
  return made;
}

function button_element(row: PopupRow): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.disabled = !row.enabled;
  const text = element("span", "desertfox-popup-text", row.label);
  if (row.detail !== undefined) text.append(element("span", "desertfox-popup-detail", row.detail));
  button.append(text);
  button.addEventListener("click", () => void act(row));
  return button;
}

function row_button(row: PopupRow, extra_class: string): HTMLButtonElement {
  const button = button_element(row);
  button.className = `desertfox-popup-row ${extra_class}`;
  return button;
}

function header_element(version: string, disabled: boolean): HTMLElement {
  const header = element("div", "desertfox-popup-header");
  const icon = document.createElement("img");
  icon.className = "desertfox-popup-icon";
  icon.alt = "";
  icon.src = disabled ? "icons/desertfox-off.svg" : "icons/desertfox.svg";
  header.append(icon, element("span", "desertfox-popup-wordmark", "DesertFox"), element("span", "desertfox-popup-version", version));
  return header;
}

function power_element(row: PopupRow): HTMLElement {
  const group = element("fieldset", "desertfox-popup-segments");
  group.append(element("legend", "desertfox-popup-legend", "DesertFox"));
  for (const [name, is_on] of [["On", true], ["Off", false]] as const) {
    const label = element("label", "desertfox-popup-segment");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "power";
    radio.checked = row.on === is_on;
    // The chosen segment is the current state, so only the other one fires a change.
    radio.addEventListener("change", () => void act(row));
    label.append(radio, element("span", "desertfox-popup-segment-text", name));
    group.append(label);
  }
  return group;
}

function card_element(rows: PopupRow[], inputs: { site: SiteState; disabled: boolean }): HTMLElement {
  const card = element("div", "desertfox-popup-card");
  const { host, state } = site_card(inputs.site, inputs.disabled);
  card.append(element("div", "desertfox-popup-host", host), element("div", "desertfox-popup-state", state));
  const site = rows.find((row) => row.id === "site")!;
  card.append(row_button(site, "desertfox-popup-site"));
  const rule = rows.find((row) => row.id === "rule");
  if (rule !== undefined) card.append(row_button(rule, "desertfox-popup-rule desertfox-popup-link"));
  return card;
}

async function draw(): Promise<void> {
  const [tab, stored, host] = await Promise.all([
    active_tab(),
    browser.storage.local.get([DISABLED_STORAGE_KEY, WARNINGS_STORAGE_KEY]),
    browser.permissions.contains({ permissions: ["nativeMessaging"] }),
  ]);
  const inputs = {
    disabled: stored[DISABLED_STORAGE_KEY] === true,
    site: await read_site(tab?.url),
    warning_count: ((stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? []).length,
    version: browser.runtime.getManifest().version,
    has_native_host: host,
  };
  const rows = build_rows(inputs);
  const by_id = (id: PopupRow["id"]) => rows.find((row) => row.id === id)!;
  const elements = [header_element(inputs.version, inputs.disabled), power_element(by_id("power")), card_element(rows, inputs)];
  for (const id of ["settings", "home", "reload_config", "warnings"] as const) elements.push(row_button(by_id(id), "desertfox-popup-link"));
  if (notice !== "") {
    const line = element("div", "desertfox-popup-notice", notice);
    line.setAttribute("role", "status");
    elements.push(line);
  }
  // A redraw replaces the radios, so a keyboard user keeps the focus on the group.
  const had_focus = document.activeElement instanceof HTMLInputElement && document.activeElement.name === "power";
  root.replaceChildren(...elements);
  if (had_focus) root.querySelector<HTMLInputElement>("input[name=power]:checked")?.focus();
}

follow_theme(":root, .desertfox-popup");
void draw();
