import { load_commands_file } from "../shared/load_commands.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { load_config } from "../background/config_load.ts";
import { CONFIG_STATUS_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import type { ConfigStatus } from "../options/model.ts";
import { build_help_model } from "./model.ts";
import type { HelpModel } from "./model.ts";
import { engine_anchor, render_help } from "./render.ts";
import { parse_route } from "./route.ts";

function show_route(model: HelpModel): void {
  const route = parse_route(location.hash);
  render_help(document.body, model, route);
  // A new page starts at the top. An engine link scrolls to its row.
  const row = route.engine === undefined ? null : document.getElementById(engine_anchor(route.engine));
  if (row) {
    row.classList.add("oasisfox-help-current");
    row.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

async function main(): Promise<void> {
  const commands_file = await load_commands_file();
  const stored = await browser.storage.local.get([COMPILED_KEYMAP_STORAGE_KEY, WARNINGS_STORAGE_KEY, CONFIG_STATUS_STORAGE_KEY]);
  const { config } = await load_config();
  const model = build_help_model(
    commands_file.commands,
    stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined,
    (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
    { search_engines: Object.keys(config.search_engines) },
    config.search_engines,
    stored[CONFIG_STATUS_STORAGE_KEY] as ConfigStatus | undefined,
  );
  show_route(model);
  window.addEventListener("hashchange", () => show_route(model));
}

void main();
