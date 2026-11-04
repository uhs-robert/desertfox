// The new tab page widgets: the clock and date by default, then the IP and weather lines under a config that turns them on.
// The network is stubbed by seeding the 5 minute cache in storage.local, so no request leaves the test. Shots go to OASISFOX_SHOT_DIR when it is set.
// It swaps the config and reloads, so it runs first, while few tabs are open: a reload with many tabs open has left load_config_dir waiting. It loads the test config again at the end.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_background } from "./rdp.mjs";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");
const NEWTAB_VIEW = `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/newtab.html"))`;

export async function run_cases({ config_dir, load_config_dir, take_shot, run_case, expect, sleep, open_page, rdp, extension_id }) {
  const shot_dir = process.env.OASISFOX_SHOT_DIR;
  const in_background = (script) => evaluate_in_background(rdp, extension_id, script);

  const open_new_tab = async (selector) => {
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    let found = false;
    for (let attempt = 0; attempt < 40 && !found; attempt++) {
      await sleep(250);
      found = await in_background(`!!${NEWTAB_VIEW}?.document.querySelector(${JSON.stringify(selector)})`).catch(() => false);
    }
    return found;
  };
  const close_new_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
  const lines_of_page = () => in_background(`(() => { const page = ${NEWTAB_VIEW}.document; return { clock: !!page.querySelector("svg.clock"), second_hand: page.querySelector("svg.clock .second")?.getAttribute("transform") ?? "", date: page.querySelector(".date")?.textContent ?? "", ip: page.querySelector(".ip")?.textContent ?? "", weather: page.querySelector(".weather")?.textContent ?? "" }; })()`);

  await run_case("the new tab page shows the clock and the date, and no IP or weather by default", async () => {
    expect(await open_new_tab("svg.clock"), "the clock never rendered");
    await sleep(500);
    const lines = await lines_of_page();
    expect(lines.second_hand.startsWith("rotate("), `the seconds hand had no angle: ${lines.second_hand}`);
    expect(lines.date !== "", "the date line is empty");
    expect(lines.ip === "" && lines.weather === "", `IP or weather showed without the settings: ${lines.ip} ${lines.weather}`);
    if (shot_dir) await take_shot(`${shot_dir}/newtab-clock.png`);
    await close_new_tabs();
  });

  const widgets_config = mkdtempSync(join(tmpdir(), "oasisfox-widgets-"));
  cpSync(test_config_dir, widgets_config, { recursive: true });
  writeFileSync(join(widgets_config, "settings.toml"), 'newtab_ip = true\nnewtab_weather = true\nweather_units = "us"\n');
  // load_config_dir types qr, so a normal page must hold the keys.
  await open_page("page", "widgets_config", { new_tab: true });
  await load_config_dir(widgets_config);
  const seeded_at = Date.now();
  await in_background(`browser.storage.local.set({
    oasisfox_newtab_ip: { at: ${seeded_at}, params: "", value: { ip: "203.0.113.7", city: "Oslo", latitude: 59.9, longitude: 10.7 } },
    oasisfox_newtab_weather: { at: ${seeded_at}, params: "59.9,10.7,us", value: { temperature: 38, unit: "°F", description: "Partly cloudy" } },
  })`);

  await run_case("the new tab page shows the IP and weather lines from the cache when their settings are on", async () => {
    expect(await open_new_tab(".weather"), "the weather line never rendered");
    const lines = await lines_of_page();
    expect(lines.ip === "203.0.113.7 · Oslo", `the IP line was ${lines.ip}`);
    expect(lines.weather === "38°F · Partly cloudy · Oslo", `the weather line was ${lines.weather}`);
    if (shot_dir) await take_shot(`${shot_dir}/newtab-clock-ip-weather.png`);
    await close_new_tabs();
  });

  await in_background(`browser.storage.local.remove(["oasisfox_newtab_ip", "oasisfox_newtab_weather"])`);
  await open_page("page", "widgets_restore", { new_tab: true });
  await load_config_dir(config_dir);
}
