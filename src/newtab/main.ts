import { resolve_new_tab_page } from "../shared/config.ts";
import { load_config } from "../background/config_load.ts";
import { render_new_tab } from "./render.ts";

async function main(): Promise<void> {
  const { config } = await load_config();
  const target = resolve_new_tab_page(config.settings.new_tab_page);
  if (target.kind === "redirect") location.replace(target.url);
  else render_new_tab(document.body);
}

void main();
