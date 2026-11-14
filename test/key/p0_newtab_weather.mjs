// The opt-in weather card. With it off the page makes no weather request. With it on and neither the geolocation permission nor a city, the page shows the permission button and still makes no request. The test profile has no network, so a request would be a bug.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_background } from "./rdp.mjs";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");
const NEWTAB_VIEW = `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/newtab.html"))`;

export const areas = ["newtab", "config"];

export async function run_cases({ config_dir, load_config_dir, take_shot, run_case, expect, poll_until, open_page, rdp, extension_id }) {
  const in_background = (script) => evaluate_in_background(rdp, extension_id, script);
  const open_new_tab = async (selector) => {
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    return poll_until(`the new tab page to render ${selector}`, () => in_background(`!!${NEWTAB_VIEW}?.document.querySelector(${JSON.stringify(selector)})`).catch(() => false), { timeout_ms: 10000 }).then(() => true, () => false);
  };
  const close_new_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
  const weather_requests = () => in_background(`${NEWTAB_VIEW}.performance.getEntriesByType("resource").filter((entry) => entry.name.includes("open-meteo.com")).length`);
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
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

    // A stored reading younger than the TTL draws with no request, so the layout shows without a network.
    await use_settings("weather_card", "newtab_weather = true\nnewtab_weather_city = \"Oslo\"\n");
    await in_background(`browser.storage.local.set({ newtab_net_cache_weather: { key: "city:Oslo|metric", at: Date.now(), value: { temperature: 10.4, feels_like: 8.2, humidity: 44, rain_chance: 30, code: 0, place: "Oslo", units: "metric" } } })`);
    await run_case("a stored reading draws in the top-right corner with feels like, humidity and rain chance, and the button beside it", async () => {
      expect(await open_new_tab(".weather-reading"), "the stored reading never drew");
      const shape = await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const box = page.querySelector(".weather").getBoundingClientRect(); const main = page.querySelector(".desertfox-newtab").getBoundingClientRect(); return { temp: page.querySelector(".weather-temp").textContent, labels: [...page.querySelectorAll(".weather-label")].map((node) => node.textContent), values: [...page.querySelectorAll(".weather-value")].map((node) => node.textContent), icon: !!page.querySelector("svg.weather-icon path"), ask: !!page.querySelector(".weather-ask"), right_gap: main.right - box.right, top_gap: box.top - main.top, in_right_half: box.left > main.width / 2 }; })()`);
      expect(shape.temp === "10\u00b0" && shape.icon, `the main row was wrong: ${JSON.stringify(shape)}`);
      expect(JSON.stringify(shape.labels) === JSON.stringify(["Feels like", "Humidity", "Rain chance"]) && JSON.stringify(shape.values) === JSON.stringify(["8\u00b0", "44%", "30%"]), `the stats were wrong: ${JSON.stringify(shape)}`);
      expect(shape.ask, "the location button is missing beside a city reading");
      expect(shape.in_right_half && shape.right_gap < 40 && shape.top_gap < 40, `the card is not in the top-right corner: ${JSON.stringify(shape)}`);
      expect((await weather_requests()) === 0, "a stored reading sent a request");
      if (shot_dir) await take_shot(`${shot_dir}/newtab-weather.png`);
    });
  } finally {
    await close_new_tabs().catch(() => undefined);
    await open_page("page", "weather_restore", { new_tab: true });
    await load_config_dir(config_dir);
  }
}
