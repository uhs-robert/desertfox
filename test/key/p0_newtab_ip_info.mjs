// The opt-in IP info line and the settings gear. With the line off the page has no slot and makes no request. With it on, a stored answer younger than a minute draws under the date with no request, because the test profile has no network. The gear is the one Settings link, in the top-left corner.
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
  const cloudflare_requests = () => in_background(`${NEWTAB_VIEW}.performance.getEntriesByType("resource").filter((entry) => entry.name.includes("1.1.1.1")).length`);
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
    await in_background(`browser.storage.local.set({ newtab_net_cache_ip: { key: "trace", at: Date.now(), value: { ip: "108.39.124.74", country: "US" } } })`);
    await use_settings("ip_off", "newtab_ip_info = false\n");
    await run_case("with newtab_ip_info off the page has no IP line, makes no request and deletes the stored answer", async () => {
      expect(await open_new_tab(".date"), "the page never rendered");
      await poll_until("the stored answer to be deleted", async () => !(await in_background(`browser.storage.local.get("newtab_net_cache_ip").then((found) => "newtab_net_cache_ip" in found)`)));
      expect(await in_background(`!${NEWTAB_VIEW}.document.querySelector(".ip-info")`), "an IP slot was drawn while the setting is off");
      expect((await cloudflare_requests()) === 0, "the page requested 1.1.1.1 while the setting is off");
    });

    await in_background(`browser.storage.local.set({ newtab_net_cache_ip: { key: "trace", at: Date.now(), value: { ip: "108.39.124.74", country: "US" } }, newtab_net_cache_weather: { key: "city:Oslo|metric", at: Date.now(), value: { temperature: 10.4, feels_like: 8.2, humidity: 44, rain_chance: 30, code: 0, place: "Oslo", units: "metric" } } })`);
    await use_settings("ip_on", "newtab_ip_info = true\nnewtab_weather = true\nnewtab_weather_city = \"Oslo\"\n");
    await run_case("a stored answer draws one muted line under the date, and the gear is the top-left Settings link", async () => {
      expect(await open_new_tab(".ip-info"), "the IP slot never drew");
      await poll_until("the IP line and the weather to render", async () => (await in_background(`${NEWTAB_VIEW}.document.querySelector(".ip-info").textContent`)) !== "" && (await in_background(`!!${NEWTAB_VIEW}.document.querySelector(".weather-reading")`)));
      if (shot_dir) await take_shot(`${shot_dir}/newtab-ip-weather.png`);
      const shape = await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const ip = page.querySelector(".ip-info"); const date = page.querySelector(".date").getBoundingClientRect(); const line = ip.getBoundingClientRect(); const gear = page.querySelector("a.settings-gear"); const box = gear.getBoundingClientRect(); const links = [...page.querySelectorAll(".builtin-links a")].map((link) => link.textContent); return { text: ip.textContent, under_date: line.top >= date.bottom - 1 && line.top - date.bottom < 40, centered: Math.abs((line.left + line.right) / 2 - (date.left + date.right) / 2) < 20, gear_href: gear.getAttribute("href"), gear_label: gear.getAttribute("aria-label"), gear_icon: !!gear.querySelector("svg path"), gear_top_left: box.left < 60 && box.top < 60, links }; })()`);
      expect(shape.text === "108.39.124.74, United States", `the line was ${JSON.stringify(shape)}`);
      expect(shape.under_date && shape.centered, `the line is not under the date: ${JSON.stringify(shape)}`);
      expect(shape.gear_href === "home.html#/settings" && shape.gear_label === "Settings" && shape.gear_icon && shape.gear_top_left, `the gear was wrong: ${JSON.stringify(shape)}`);
      expect(JSON.stringify(shape.links) === JSON.stringify(["Getting Started", "Help"]), `the text links were ${JSON.stringify(shape.links)}`);
      expect((await cloudflare_requests()) === 0, "a stored answer sent a request");
    });
  } finally {
    await close_new_tabs().catch(() => undefined);
    await open_page("page", "ip_restore", { new_tab: true });
    await load_config_dir(config_dir);
  }
}
