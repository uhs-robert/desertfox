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
import { build_rows, disabled_after_click, HOME_HASH, SETTINGS_HASH, WARNINGS_HASH } from "./model.ts";
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
  else if (row.id === "rule") return open_help_page(SETTINGS_HASH);
  else if (row.id === "site") {
    const answer = await ask({ type: "toolbar_site", url: tab?.url ?? "", action: row.site_action ?? "disable" });
    notice = answer.message;
  } else if (row.id === "reload_config") notice = (await ask({ type: "toolbar_reload_config" })).message;
  await draw();
}

function row_element(row: PopupRow): HTMLElement {
  if (row.kind === "info") {
    const info = document.createElement("div");
    info.className = "desertfox-popup-info";
    info.textContent = row.label;
    return info;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "desertfox-popup-row";
  button.disabled = !row.enabled;
  button.append(row.label);
  if (row.detail !== undefined) {
    const detail = document.createElement("span");
    detail.className = "desertfox-popup-detail";
    detail.textContent = row.detail;
    button.append(detail);
  }
  if (row.kind === "switch") {
    button.classList.add("desertfox-popup-power");
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", String(row.on));
    button.addEventListener("click", () => void act(row));
  } else button.addEventListener("click", () => void act(row));
  return button;
}

async function draw(): Promise<void> {
  const [tab, stored, host] = await Promise.all([
    active_tab(),
    browser.storage.local.get([DISABLED_STORAGE_KEY, WARNINGS_STORAGE_KEY]),
    browser.permissions.contains({ permissions: ["nativeMessaging"] }),
  ]);
  const rows = build_rows({
    disabled: stored[DISABLED_STORAGE_KEY] === true,
    site: await read_site(tab?.url),
    warning_count: ((stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? []).length,
    version: browser.runtime.getManifest().version,
    has_native_host: host,
  });
  const elements = rows.map(row_element);
  if (notice !== "") {
    const line = document.createElement("div");
    line.className = "desertfox-popup-notice";
    line.setAttribute("role", "status");
    line.textContent = notice;
    elements.splice(elements.length - 1, 0, line);
  }
  root.replaceChildren(...elements);
}

follow_theme(":root, .desertfox-popup");
void draw();
