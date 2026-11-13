import { load_commands_file } from "../shared/load_commands.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { build_config_status, load_effective_config } from "../background/config_load.ts";
import { WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { follow_theme, follow_user_css } from "../shared/theme/apply.ts";
import { follow_settings } from "../shared/storage_watch.ts";
import type { Block } from "./blocks.ts";
import { build_help_model } from "./model.ts";
import type { HelpModel } from "./model.ts";
import { close_drawer_on_escape, close_drawer_on_window_blur, command_anchor, engine_anchor, render_help, section_anchor, update_config_source } from "./render.ts";
import { mount_grant_panel } from "./grant_panel.ts";
import { mount_settings } from "./settings_page.ts";
import { create_user_css_gate, NO_USER_CSS_HOLD, type UserCssHold } from "./user_css_gate.ts";
import { mount_transfer } from "./transfer_page.ts";
import { mount_files } from "./files_page.ts";
import { create_files_session } from "./files_model.ts";
import { FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY } from "../background/storage_keys.ts";
import { create_host_start_session } from "./host_start_model.ts";
import { mount_host_start } from "./host_start_page.ts";
import { parse_route } from "./route.ts";

let stop_settings: (() => void) | undefined;
// The hold of the mounted import section. A new mount replaces it, and the old one can no longer change the gate.
let transfer_hold: UserCssHold = NO_USER_CSS_HOLD;
// The same for the files editor, so its consent card and the import review never release each other.
let files_hold: UserCssHold = NO_USER_CSS_HOLD;
// One session for the page's life: leaving the settings route and coming back keeps an unsaved draft and a running save.
const files_session = create_files_session({ send: (message) => browser.runtime.sendMessage(message), on_change: () => undefined });
// Redraws the banner of the mounted settings route, if any.
let draw_host_start: () => void = () => undefined;
const host_start_session = create_host_start_session({
  read_pending: async () => (await browser.storage.local.get(HOST_START_PENDING_STORAGE_KEY))[HOST_START_PENDING_STORAGE_KEY],
  send: (message) => browser.runtime.sendMessage(message),
  on_change: () => draw_host_start(),
});
void host_start_session.load();
// An import, a reload or another tab changed the stored files: the editor reads them again. A start, a choice or a swap changed the host start question: the banner follows.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && FILES_SOURCE_STORAGE_KEY in changes) void files_session.load();
  if (area === "local" && HOST_START_PENDING_STORAGE_KEY in changes) void host_start_session.load();
});

// `refresh` draws the same route again after a settings change. The caller keeps scroll and focus, so the route's own scroll and focus rules stay out.
function show_route(model: HelpModel, guide: Block[], engines: string[], cause: "first" | "moved" | "refresh"): void {
  const route = parse_route(location.hash);
  stop_settings?.();
  stop_settings = undefined;
  render_help(document.body, model, route, guide);
  const settings_box = route.page === "settings" ? document.querySelector<HTMLElement>(".desertfox-settings") : null;
  if (settings_box) stop_settings = mount_settings(settings_box, (message) => browser.runtime.sendMessage(message), engines, browser.storage.onChanged as never);
  const host_start_box = route.page === "settings" ? document.querySelector<HTMLElement>(".desertfox-host-start") : null;
  draw_host_start = host_start_box ? mount_host_start(host_start_box, host_start_session, (message) => browser.runtime.sendMessage(message)) : () => undefined;
  draw_host_start();
  const transfer_box = route.page === "settings" ? document.querySelector<HTMLElement>(".desertfox-transfer") : null;
  transfer_hold.dispose();
  transfer_hold = open_user_css_hold();
  if (transfer_box) mount_transfer(transfer_box, (message) => browser.runtime.sendMessage(message), transfer_hold);
  const files_box = route.page === "settings" ? document.querySelector<HTMLElement>(".desertfox-files") : null;
  files_hold.dispose();
  files_hold = open_user_css_hold();
  if (files_box) mount_files(files_box, files_session, files_hold);
  if (cause === "refresh") return;
  // The render removed the link that had focus. Not on first load, where focus belongs to the browser.
  const section_heading = route.section === undefined ? null : document.getElementById(section_anchor(route.page, route.section));
  if (section_heading) {
    section_heading.scrollIntoView();
    section_heading.focus({ preventScroll: true });
    return;
  }
  if (cause === "moved") document.querySelector<HTMLElement>(".desertfox-help-page h1")?.focus({ preventScroll: true });
  // A new page starts at the top. An engine or command link scrolls to its row or card.
  const anchor = route.engine !== undefined ? engine_anchor(route.engine) : route.command !== undefined ? command_anchor(route.command) : undefined;
  const row = anchor === undefined ? null : document.getElementById(anchor);
  if (row) {
    row.classList.add("desertfox-help-current");
    row.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

type Inputs = { model_: HelpModel; guide: Block[]; engines: string[] };
let current: Inputs | undefined;
let loaded_guide: Block[] | undefined;

// Reads everything the pages show. The settings change the Home rows and the engines, so every draw reads them again.
async function load_inputs(): Promise<Inputs> {
  const commands_file = await load_commands_file();
  const stored = await browser.storage.local.get([COMPILED_KEYMAP_STORAGE_KEY, WARNINGS_STORAGE_KEY]);
  const { config, source, edits, config_settings } = await load_effective_config();
  const model = build_help_model(
    commands_file.commands,
    current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined),
    (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
    { search_engines: Object.keys(config.search_engines) },
    config.search_engines,
    // The same shape the background stores, built from the fresh load so a config.reload shows at once.
    build_config_status(source, config_settings, edits),
  );
  // A missing guide must not blank the other pages. The guide ships with the build, so one fetch serves every draw.
  loaded_guide ??= await fetch(browser.runtime.getURL("search_engines_guide.json")).then((response) => response.json() as Promise<Block[]>).catch(() => []);
  return { model_: model, guide: loaded_guide, engines: Object.keys(config.search_engines) };
}

// The Settings page follows storage by itself and keeps what the user is typing, so a full redraw there would only clobber it. It still takes the new inputs, for the next page.
async function draw(first: boolean): Promise<void> {
  current = await load_inputs();
  if (first) show_route(current.model_, current.guide, current.engines, "first");
  else if (parse_route(location.hash).page !== "settings") show_route(current.model_, current.guide, current.engines, "refresh");
  else update_config_source(current.model_);
}

window.addEventListener("keydown", close_drawer_on_escape, true);
window.addEventListener("blur", close_drawer_on_window_blur);
window.addEventListener("hashchange", () => current && show_route(current.model_, current.guide, current.engines, "moved"));
follow_theme(":root, .desertfox-help");
const open_user_css_hold = create_user_css_gate(follow_user_css());
follow_settings(draw);
mount_grant_panel(open_user_css_hold());
