import { load_commands_file } from "../shared/load_commands.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { load_config } from "../background/config_load.ts";
import { WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { effective_settings } from "../shared/config.ts";
import type { Block } from "./blocks.ts";
import { build_help_model } from "./model.ts";
import type { HelpModel } from "./model.ts";
import { command_anchor, engine_anchor, render_help, section_anchor } from "./render.ts";
import { parse_route } from "./route.ts";

function show_route(model: HelpModel, guide: Block[], moved_by_user: boolean): void {
  const route = parse_route(location.hash);
  render_help(document.body, model, route, guide);
  // The render removed the link that had focus. Not on first load, where focus belongs to the browser.
  const section_heading = route.section === undefined ? null : document.getElementById(section_anchor(route.section));
  if (section_heading) {
    section_heading.scrollIntoView();
    section_heading.focus({ preventScroll: true });
    return;
  }
  if (moved_by_user) document.querySelector<HTMLElement>(".oasisfox-help-page h1")?.focus({ preventScroll: true });
  // A new page starts at the top. An engine or command link scrolls to its row or card.
  const anchor = route.engine !== undefined ? engine_anchor(route.engine) : route.command !== undefined ? command_anchor(route.command) : undefined;
  const row = anchor === undefined ? null : document.getElementById(anchor);
  if (row) {
    row.classList.add("oasisfox-help-current");
    row.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

async function main(): Promise<void> {
  const commands_file = await load_commands_file();
  const stored = await browser.storage.local.get([COMPILED_KEYMAP_STORAGE_KEY, WARNINGS_STORAGE_KEY]);
  const { config, source } = await load_config();
  const model = build_help_model(
    commands_file.commands,
    stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined,
    (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
    { search_engines: Object.keys(config.search_engines) },
    config.search_engines,
    // The same shape the background stores, built from the fresh load so a config.reload shows at once.
    { source, settings: effective_settings(config.settings), managed_file_hint: `~/.mozilla/managed-storage/${browser.runtime.id}.json` },
  );
  // A missing guide must not blank the other pages.
  const guide = await fetch(browser.runtime.getURL("search_engines_guide.json")).then((response) => response.json() as Promise<Block[]>).catch(() => []);
  show_route(model, guide, false);
  window.addEventListener("hashchange", () => show_route(model, guide, true));
}

void main();
