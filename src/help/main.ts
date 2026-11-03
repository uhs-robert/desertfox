import { load_commands_file } from "../shared/load_commands.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { load_config } from "../background/config_load.ts";
import { WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { build_help_model } from "./model.ts";
import { render_help } from "./render.ts";

async function main(): Promise<void> {
  const commands_file = await load_commands_file();
  const stored = await browser.storage.local.get([COMPILED_KEYMAP_STORAGE_KEY, WARNINGS_STORAGE_KEY]);
  const { config } = await load_config();
  const model = build_help_model(
    commands_file.commands,
    stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined,
    (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
    { search_engines: Object.keys(config.search_engines) },
  );
  render_help(document.body, model);
}

void main();
