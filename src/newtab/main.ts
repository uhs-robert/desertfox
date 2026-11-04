import { resolve_new_tab_page } from "../shared/config.ts";
import { load_config } from "../background/config_load.ts";
import { render_new_tab } from "./render.ts";

async function main(): Promise<void> {
  const { config } = await load_config();
  const target = resolve_new_tab_page(config.settings.new_tab_page, location.search);
  if (target.kind === "redirect") {
    try {
      location.replace(target.url);
      return;
    } catch {
      // A URL that passed the checks and still fails to load leaves the built-in page, not a blank tab.
    }
  }
  const fetch_json = async (url: string) => (await fetch(url, { signal: AbortSignal.timeout(5000) })).json();
  render_new_tab(document.body, config.settings, { fetch_json, area: browser.storage.local, now: Date.now() });
}

void main();
