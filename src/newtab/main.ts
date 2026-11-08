import { effective_settings, resolve_new_tab_page } from "../shared/config.ts";
import { load_effective_config } from "../background/config_load.ts";
import { render_new_tab } from "./render.ts";
import { follow_theme, follow_user_css } from "../shared/theme/apply.ts";
import { follow_settings } from "../shared/storage_watch.ts";

// Draws the page from the settings in force. Only the first draw may redirect: a tab that already shows the built-in page stays on it when `new_tab_page` changes.
async function draw(first: boolean): Promise<void> {
  const { config } = await load_effective_config();
  const target = resolve_new_tab_page(config.settings.new_tab_page, location.search);
  if (first && target.kind === "redirect") {
    try {
      location.replace(target.url);
      return;
    } catch {
      // A URL that passed the checks and still fails to load leaves the built-in page, not a blank tab.
    }
  }
  await render_new_tab(document.body, effective_settings(config.settings));
}

follow_theme(":root");
follow_user_css();
follow_settings(draw);
