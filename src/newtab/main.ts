import { resolve_new_tab_page } from "../shared/config.ts";
import { load_effective_config } from "../background/config_load.ts";
import { render_new_tab } from "./render.ts";

async function main(): Promise<void> {
  const { config } = await load_effective_config();
  const target = resolve_new_tab_page(config.settings.new_tab_page, location.search);
  if (target.kind === "redirect") {
    try {
      location.replace(target.url);
      return;
    } catch {
      // A URL that passed the checks and still fails to load leaves the built-in page, not a blank tab.
    }
  }
  render_new_tab(document.body, config.settings);
}

void main();
