import { CONFIG_STATUS_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { load_commands_file } from "../shared/load_commands.ts";
import { build_options_model } from "./model.ts";
import type { ConfigStatus } from "./model.ts";
import { render_options } from "./render.ts";
import { follow_theme } from "../shared/theme/apply.ts";

async function main(): Promise<void> {
  const stored = await browser.storage.local.get([CONFIG_STATUS_STORAGE_KEY, WARNINGS_STORAGE_KEY]);
  const commands_file = await load_commands_file();
  const model = build_options_model(
    stored[CONFIG_STATUS_STORAGE_KEY] as ConfigStatus | undefined,
    (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
    commands_file.commands,
  );
  render_options(document.body, model);
}

follow_theme(":root, .oasisfox-options");
void main();
