import { load_commands_file } from "../shared/load_commands.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { build_config_status, load_effective_config } from "../background/config_load.ts";
import { WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { follow_theme, follow_user_css } from "../shared/theme/apply.ts";
import { follow_settings } from "../shared/storage_watch.ts";
import type { Block } from "./blocks.ts";
import { build_help_model } from "./model.ts";
import type { HelpModel } from "./model.ts";
import { close_drawer_on_escape, close_drawer_on_window_blur, command_anchor, engine_anchor, render_help, section_anchor, update_config_source } from "./render.ts";
import { mount_native_install } from "./native_install.ts";
import { mount_settings } from "./settings_page.ts";
import { parse_route } from "./route.ts";

let stop_settings: (() => void) | undefined;

// `refresh` draws the same route again after a settings change. The caller keeps scroll and focus, so the route's own scroll and focus rules stay out.
function show_route(model: HelpModel, guide: Block[], engines: string[], cause: "first" | "moved" | "refresh"): void {
  const route = parse_route(location.hash);
  stop_settings?.();
  stop_settings = undefined;
  render_help(document.body, model, route, guide);
  const settings_box = route.page === "settings" ? document.querySelector<HTMLElement>(".desertfox-settings") : null;
  if (settings_box) stop_settings = mount_settings(settings_box, (message) => browser.runtime.sendMessage(message), engines, browser.storage.onChanged as never);
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

type Inputs = { model: HelpModel; guide: Block[]; engines: string[] };
let current: Inputs | undefined;
let loaded_guide: Block[] | undefined;

// Reads everything the pages show. The settings change the Home rows and the engines, so every draw reads them again.
async function load_inputs(): Promise<Inputs> {
  const commands_file = await load_commands_file();
  const stored = await browser.storage.local.get([COMPILED_KEYMAP_STORAGE_KEY, WARNINGS_STORAGE_KEY]);
  const { config, source, edits, config_settings } = await load_effective_config();
  const model = build_help_model(
    commands_file.commands,
    stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined,
    (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
    { search_engines: Object.keys(config.search_engines) },
    config.search_engines,
    // The same shape the background stores, built from the fresh load so a config.reload shows at once.
    build_config_status(source, config_settings, edits, `~/.mozilla/managed-storage/${browser.runtime.id}.json`),
  );
  // A missing guide must not blank the other pages. The guide ships with the build, so one fetch serves every draw.
  loaded_guide ??= await fetch(browser.runtime.getURL("search_engines_guide.json")).then((response) => response.json() as Promise<Block[]>).catch(() => []);
  return { model, guide: loaded_guide, engines: Object.keys(config.search_engines) };
}

// The Settings page follows storage by itself and keeps what the user is typing, so a full redraw there would only clobber it. It still takes the new inputs, for the next page.
async function draw(first: boolean): Promise<void> {
  current = await load_inputs();
  if (first) show_route(current.model, current.guide, current.engines, "first");
  else if (parse_route(location.hash).page !== "settings") show_route(current.model, current.guide, current.engines, "refresh");
  else update_config_source(current.model);
}

window.addEventListener("keydown", close_drawer_on_escape, true);
window.addEventListener("blur", close_drawer_on_window_blur);
window.addEventListener("hashchange", () => current && show_route(current.model, current.guide, current.engines, "moved"));
follow_theme(":root, .desertfox-help");
follow_user_css();
follow_settings(draw);
mount_native_install();
