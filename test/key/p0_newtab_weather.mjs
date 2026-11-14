// The opt-in weather card. With it off the page makes no weather request. With it on and neither the geolocation permission nor a city, the page shows the permission button and still makes no request. The test profile has no network, so a request would be a bug.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_background } from "./rdp.mjs";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");
const NEWTAB_VIEW = `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/newtab.html"))`;

export const areas = ["newtab", "config"];

export async function run_cases({ config_dir, load_config_dir, run_case, expect, poll_until, open_page, rdp, extension_id }) {
  const in_background = (script) => evaluate_in_background(rdp, extension_id, script);
  const open_new_tab = async (selector) => {
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    return poll_until(`the new tab page to render ${selector}`, () => in_background(`!!${NEWTAB_VIEW}?.document.querySelector(${JSON.stringify(selector)})`).catch(() => false), { timeout_ms: 10000 }).then(() => true, () => false);
  };
  const close_new_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
  const weather_requests = () => in_background(`${NEWTAB_VIEW}.performance.getEntriesByType("resource").filter((entry) => entry.name.includes("open-meteo.com")).length`);
  const use_settings = async (name, text) => {
    const dir = mkdtempSync(join(tmpdir(), `desertfox-${name}-`));
    cpSync(test_config_dir, dir, { recursive: true });
    writeFileSync(join(dir, "settings.toml"), text);
    await close_new_tabs();
    await open_page("page", `${name}_page`, { new_tab: true });
    await load_config_dir(dir);
  };

  try {
    await use_settings("weather_off", "newtab_weather = false\nnewtab_weather_city = \"Oslo\"\n");
    await run_case("with newtab_weather off the page has no weather card and makes no weather request", async () => {
      expect(await open_new_tab(".date"), "the page never rendered");
      await poll_until("the closed and top lists to settle", async () => (await in_background(`${NEWTAB_VIEW}.document.querySelector(".command-hint")`)) !== null);
      expect(await in_background(`!${NEWTAB_VIEW}.document.querySelector(".weather")`), "a weather slot was drawn while the setting is off");
      expect((await weather_requests()) === 0, "the page requested open-meteo while the setting is off");
    });

    await use_settings("weather_on", "newtab_weather = true\n");
    await run_case("newtab_weather on with no permission and no city shows the permission button and sends nothing", async () => {
      expect(await open_new_tab(".weather-ask"), "the permission button never showed");
      expect((await weather_requests()) === 0, "the page requested open-meteo with no place to ask about");
    });
  } finally {
    await close_new_tabs().catch(() => undefined);
    await open_page("page", "weather_restore", { new_tab: true });
    await load_config_dir(config_dir);
  }
}
