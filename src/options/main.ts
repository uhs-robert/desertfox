import { CONFIG_STATUS_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../background/storage_keys.ts";
import { build_options_model } from "./model.ts";
import type { ConfigStatus } from "./model.ts";
import { render_options } from "./render.ts";

async function main(): Promise<void> {
  const stored = await browser.storage.local.get([CONFIG_STATUS_STORAGE_KEY, WARNINGS_STORAGE_KEY]);
  const model = build_options_model(
    stored[CONFIG_STATUS_STORAGE_KEY] as ConfigStatus | undefined,
    (stored[WARNINGS_STORAGE_KEY] as string[] | undefined) ?? [],
  );
  render_options(document.body, model);
}

void main();
