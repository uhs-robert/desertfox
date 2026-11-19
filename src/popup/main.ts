import { load_effective_config } from "../background/config_load.ts";
import { plan_help_tab } from "../background/open_help.ts";
import { WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { site_pattern, site_state } from "../background/toolbar.ts";
import type { SiteState } from "../background/toolbar.ts";
import { effective_settings } from "../shared/config.ts";
import type { ChangeSetting, ToolbarAnswer, ToolbarRequest } from "../shared/messages.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { follow_theme } from "../shared/theme/apply.ts";
import { DISABLED_STORAGE_KEY, HOST_CONNECTED_STORAGE_KEY, THEME_EDITS_STORAGE_KEY } from "../background/storage_keys.ts";
import { build_rows, create_host_flag, create_notice, disabled_after_click, host_dot, release_url, site_card, theme_options, COMMANDS_HASH, HOME_HASH, SETTINGS_HASH, SUPPORT_URL, SITE_RULES_HASH, WARNINGS_HASH, site_keys_hash } from "./model.ts";
import type { HostDot, PopupRow } from "./model.ts";

const root = document.getElementById("desertfox-popup")!;
// One notice node for the life of the popup. The expiry and each new notice change its text and nothing else, so a redraw never runs for them and focus stays put.
const notice_line = document.createElement("div");
notice_line.className = "desertfox-popup-notice";
notice_line.setAttribute("role", "status");
const notice = create_notice({ after: (run, delay_ms) => { const timer = setTimeout(run, delay_ms); return () => clearTimeout(timer); }, changed: () => void (notice_line.textContent = notice.text()) });
const show_notice = (answer: ToolbarAnswer): void => {
  notice.show(answer);
  notice_line.textContent = notice.text();
};
// Each draw takes a number before its first await, and only the newest may swap the page.
let draw_generation = 0;
// The permission half of the host dot, kept for the live update.
let host_permission = false;
const host_flag = create_host_flag();

const ask = (request: ToolbarRequest): Promise<ToolbarAnswer> => browser.runtime.sendMessage(request) as Promise<ToolbarAnswer>;

async function active_tab(): Promise<browser.tabs.Tab | undefined> {
  return (await browser.tabs.query({ active: true, currentWindow: true }))[0];
}

type LoadedConfig = Awaited<ReturnType<typeof load_effective_config>>;

function read_site(url: string | undefined, { config }: LoadedConfig): SiteState {
  return site_state(url, effective_settings(config.settings).site_rules);
}

async function open_help_page(hash: string): Promise<void> {
  const tab = await active_tab();
  const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
  const plan = plan_help_tab(help_page_url, help_page_url + hash, { id: tab?.id, window_id: tab?.windowId, url: tab?.url });
  if (plan.kind === "update") await browser.tabs.update(plan.tab_id, { url: plan.url });
  else await browser.tabs.create({ url: plan.url, ...(plan.opener ?? {}) });
  window.close();
}

async function open_page_beside(url: string): Promise<void> {
  const tab = await active_tab();
  await browser.tabs.create({ url, ...(tab?.id === undefined ? {} : { openerTabId: tab.id }) });
  window.close();
}

async function act(row: PopupRow): Promise<void> {
  const tab = await active_tab();
  if (row.id === "power") show_notice(await ask({ type: "toolbar_set_disabled", disabled: disabled_after_click(row) }));
  else if (row.id === "settings") return open_help_page(SETTINGS_HASH);
  else if (row.id === "home") return open_help_page(HOME_HASH);
  else if (row.id === "keys") return open_help_page(COMMANDS_HASH);
  else if (row.id === "support") return open_page_beside(SUPPORT_URL);
  else if (row.id === "warnings") return open_help_page(WARNINGS_HASH);
  else if (row.id === "rule") return open_help_page(SITE_RULES_HASH);
  else if (row.id === "keys_for_site") {
    const pattern = site_pattern(tab?.url);
    if (pattern !== undefined) return open_help_page(site_keys_hash(pattern));
  } else if (row.id === "site") {
    show_notice(await ask({ type: "toolbar_site", url: tab?.url ?? "", action: row.site_action ?? "disable" }));
  } else if (row.id === "reload_config") show_notice(await ask({ type: "toolbar_reload_config" }));
  await draw();
}

// The settings page's own request, so the one validator checks the name and `desktop` passes like any theme. Layer `file` writes settings.toml, so the pick lasts and the file stays the one source.
async function pick_theme(name: string): Promise<void> {
  show_notice((await browser.runtime.sendMessage({ type: "change_setting", name: "theme", action: "set", layer: "file", value: name } satisfies ChangeSetting)) as ToolbarAnswer);
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
  button.dataset.focusKey = row.id;
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

// Inline icons, drawn in the text color so they follow the theme. Each value is the path data of a 24 by 24 outline.
const ICON_PATHS = {
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  home: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  reload: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  keys: "M3 7h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM6 11h.01M10 11h.01M14 11h.01M18 11h.01M7 14.5h10",
  support: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z",
} as const;

function icon_element(id: keyof typeof ICON_PATHS): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `desertfox-popup-glyph desertfox-popup-glyph-${id}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[id]);
  svg.append(path);
  return svg;
}

function icon_button(row: PopupRow, id: keyof typeof ICON_PATHS, extra_class: string): HTMLButtonElement {
  const button = button_element(row);
  button.className = `desertfox-popup-row ${extra_class}`;
  button.prepend(icon_element(id));
  return button;
}

function paint_dot(status: HTMLElement, dot: HostDot): void {
  status.classList.toggle("desertfox-popup-host-dot-up", dot.connected);
  status.setAttribute("aria-label", dot.label);
  status.title = dot.label;
}

function header_element(version: string, disabled: boolean, dot: HostDot): HTMLElement {
  const header = element("div", "desertfox-popup-header");
  const icon = document.createElement("img");
  icon.className = "desertfox-popup-icon";
  icon.alt = "";
  icon.src = disabled ? "icons/desertfox-off.svg" : "icons/desertfox.svg";
  const link = element("a", "desertfox-popup-version", version) as HTMLAnchorElement;
  link.dataset.focusKey = "version";
  link.href = release_url(version);
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void open_page_beside(link.href);
  });
  const status = element("span", "desertfox-popup-host-dot");
  status.setAttribute("role", "img");
  paint_dot(status, dot);
  header.append(icon, element("span", "desertfox-popup-wordmark", "DesertFox"), status, link);
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
    radio.dataset.focusKey = "power";
    radio.checked = row.on === is_on;
    // The chosen segment is the current state, so only the other one fires a change.
    radio.addEventListener("change", () => void act(row));
    label.append(radio, element("span", "desertfox-popup-segment-text", name));
    group.append(label);
  }
  return group;
}

function theme_element(names: readonly string[], current: string): HTMLElement {
  const label = element("label", "desertfox-popup-theme");
  const select = document.createElement("select");
  select.className = "desertfox-popup-theme-select";
  select.dataset.focusKey = "theme";
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === current;
    select.append(option);
  }
  select.addEventListener("change", () => void pick_theme(select.value));
  label.append(element("span", "desertfox-popup-theme-text", "Theme"), select);
  return label;
}

function card_element(rows: PopupRow[], inputs: { site: SiteState; disabled: boolean }): HTMLElement {
  const card = element("div", "desertfox-popup-card");
  const { host, state } = site_card(inputs.site, inputs.disabled);
  card.append(element("div", "desertfox-popup-host", host), element("div", "desertfox-popup-state", state));
  const site = rows.find((row) => row.id === "site")!;
  card.append(row_button(site, "desertfox-popup-site"));
  card.append(row_button(rows.find((row) => row.id === "keys_for_site")!, "desertfox-popup-keys-for-site desertfox-popup-link"));
  const rule = rows.find((row) => row.id === "rule");
  if (rule !== undefined) card.append(row_button(rule, "desertfox-popup-rule desertfox-popup-link"));
  return card;
}

async function draw(): Promise<void> {
  const mine = ++draw_generation;
  const [tab, stored, host, loaded] = await Promise.all([
    active_tab(),
    browser.storage.local.get([DISABLED_STORAGE_KEY, WARNINGS_STORAGE_KEY, THEME_EDITS_STORAGE_KEY]),
    browser.permissions.contains({ permissions: ["nativeMessaging"] }),
    load_effective_config(),
  ]);
  // A newer draw started while this one waited, and it paints the newer state.
  if (mine !== draw_generation) return;
  host_permission = host;
  const inputs = {
    disabled: stored[DISABLED_STORAGE_KEY] === true,
    site: read_site(tab?.url, loaded),
    warning_count: ((stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? []).length,
    version: browser.runtime.getManifest().version,
    has_native_host: host,
    theme: effective_settings(loaded.config.settings).theme,
    extra_theme_names: [...Object.keys(loaded.config.local_themes ?? {}), ...Object.keys((stored[THEME_EDITS_STORAGE_KEY] as object | undefined) ?? {})],
  };
  const rows = build_rows(inputs);
  const by_id = (id: PopupRow["id"]) => rows.find((row) => row.id === id)!;
  const elements = [header_element(inputs.version, inputs.disabled, host_dot(inputs.has_native_host, host_flag.get())), power_element(by_id("power")), card_element(rows, inputs)];
  if (rows.some((row) => row.id === "warnings")) elements.push(row_button(by_id("warnings"), "desertfox-popup-link"));
  const pair = element("div", "desertfox-popup-pair");
  pair.append(icon_button(by_id("settings"), "settings", "desertfox-popup-half"), icon_button(by_id("home"), "home", "desertfox-popup-half"), icon_button(by_id("keys"), "keys", "desertfox-popup-half"));
  const pages = element("div", "desertfox-popup-pages");
  pages.append(icon_button(by_id("reload_config"), "reload", "desertfox-popup-action"), pair);
  elements.push(theme_element(theme_options(inputs.theme, inputs.extra_theme_names), inputs.theme), notice_line, pages, icon_button(by_id("support"), "support", "desertfox-popup-support"));
  // A redraw replaces every control, so the one that had focus gets it back by its key. The power radios share a key, and the checked one takes it.
  const focus_key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey : undefined;
  root.replaceChildren(...elements);
  if (focus_key !== undefined) root.querySelector<HTMLElement>(focus_key === "power" ? "input[data-focus-key=power]:checked" : `[data-focus-key="${focus_key}"]`)?.focus();
}

// The bridge flips the flag while the popup is open. The listener keeps the latest value and repaints the dot in place. A draw reads that value when it paints, so a change during a draw is never lost.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !(HOST_CONNECTED_STORAGE_KEY in changes)) return;
  host_flag.set(changes[HOST_CONNECTED_STORAGE_KEY]?.newValue === true);
  const dot = root.querySelector<HTMLElement>(".desertfox-popup-host-dot");
  if (dot !== null) paint_dot(dot, host_dot(host_permission, host_flag.get()));
});

async function start(): Promise<void> {
  host_flag.seed((await browser.storage.session.get(HOST_CONNECTED_STORAGE_KEY))[HOST_CONNECTED_STORAGE_KEY] === true);
  await draw();
}

follow_theme(":root, .desertfox-popup");
void start();
