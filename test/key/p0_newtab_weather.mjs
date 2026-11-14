// The opt-in weather card. With it off the page makes no weather request. With it on and neither the geolocation permission nor a city, the page shows the permission button and still makes no request. The test profile has no network, so a request would be a bug.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_background } from "./rdp.mjs";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");
const NEWTAB_VIEW = `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/newtab.html"))`;

export const areas = ["newtab", "config"];

export async function run_cases({ config_dir, load_config_dir, take_shot, run_case, expect, poll_until, open_page, rdp, extension_id, press_keys, wait_view_takes_keys }) {
  const in_background = (script) => evaluate_in_background(rdp, extension_id, script);
  // One new tab at a time: NEWTAB_VIEW takes the first matching view, which must be the one on screen for the shots.
  const open_new_tab = async (selector) => {
    await close_new_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    return poll_until(`the new tab page to render ${selector}`, () => in_background(`!!${NEWTAB_VIEW}?.document.querySelector(${JSON.stringify(selector)})`).catch(() => false), { timeout_ms: 10000 }).then(() => true, () => false);
  };
  const close_new_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
  // A backstop only: timing entries appear when a request completes. The unit tests count request starts with a fake fetch.
  const weather_requests = () => in_background(`${NEWTAB_VIEW}.performance.getEntriesByType("resource").filter((entry) => entry.name.includes("open-meteo.com")).length`);
  // A fresh air quality answer for the seeded place, so opening More reads storage and sends nothing.
  const AIR_SEED = `browser.storage.local.set({ newtab_net_cache_air: { key: "59.91,10.75|metric", at: Date.now(), value: { scale: "eu", index: 34, pm2_5: 8.4, pm10: 14.9, ozone: 70.2 } } })`;
  const WEATHER_SEED = `(() => { const hours = Array.from({ length: 12 }, (_, index) => new Date(Math.floor(Date.now() / 3600000) * 3600000 + index * 3600000).toISOString().slice(0, 16)); return browser.storage.local.set({ newtab_net_cache_weather: { key: "city:Oslo|auto", at: Date.now(), value: { temperature: 10.4, feels_like: 8.2, humidity: 44, rain_chance: 30, high: 14.2, low: 5.8, date: new Date().toISOString().slice(0, 10), utc_offset_seconds: 0, wind_speed: 11.6, wind_direction: 320, latitude: 59.91, longitude: 10.75, detail: { uv_index: 2.4, sunrise: "07:42", sunset: "15:31", hours: hours.map((time, index) => ({ time, temperature: 10 - index, rain_chance: 30 + index, code: index % 2 ? 61 : 3 })) }, code: 0, place: "Oslo", units: "metric" } } }); })()`;
  // The theme sheet applies its light set under a prefers-color-scheme media rule, and the test Firefox reports light. The shots rewrite that rule on the page and its narrow frame, never the machine's scheme.
  const take_both_shots = async (name) => {
    for (const [scheme, target] of [["dark", "@media not all"], ["light", "@media all"]]) {
      // Whatever an earlier step left in the rule, this step sets its own scheme.
      await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const rule = /@media (?:\\(prefers-color-scheme: light\\)|not all|all)(?![\\w-])/g; for (const doc of [page, page.querySelector("#narrow")?.contentDocument].filter(Boolean)) for (const sheet of doc.querySelectorAll("style")) if (sheet.textContent.includes("prefers-color-scheme: light") || sheet.dataset.scheme_set) { sheet.textContent = sheet.textContent.replace(rule, ${JSON.stringify(target)}); sheet.dataset.scheme_set = "1"; } })()`);
      await new Promise((done) => setTimeout(done, 700));
      await take_shot(`${shot_dir}/${name}-${scheme}.png`);
    }
  };
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

    // A stored reading younger than the TTL draws with no request, so the layout shows without a network. The hours start at the current UTC hour, so the strip has later hours whatever time the test runs.
    await use_settings("weather_card", "newtab_weather = true\nnewtab_weather_city = \"Oslo\"\n");
    await in_background(WEATHER_SEED);
    await in_background(AIR_SEED);
    await run_case("a stored reading draws in the top-right corner with the stats and the icon label, and the button beside it", async () => {
      expect(await open_new_tab(".weather-reading"), "the stored reading never drew");
      const shape = await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const box = page.querySelector(".weather").getBoundingClientRect(); const main = page.querySelector(".desertfox-newtab").getBoundingClientRect(); const icon = page.querySelector("svg.weather-icon"); return { temp: page.querySelector(".weather-temp").textContent, labels: [...page.querySelectorAll(".weather-reading > .weather-stat .weather-label")].map((node) => node.textContent), values: [...page.querySelectorAll(".weather-reading > .weather-stat .weather-value")].map((node) => node.textContent), icon: !!icon?.querySelector("path"), icon_role: icon?.getAttribute("role"), icon_label: icon?.getAttribute("aria-label"), icon_hidden: icon?.getAttribute("aria-hidden"), ask: !!page.querySelector(".weather-ask"), right_gap: main.right - box.right, top_gap: box.top - main.top, in_right_half: box.left > main.width / 2 }; })()`);
      expect(shape.temp === "10\u00b0" && shape.icon, `the main row was wrong: ${JSON.stringify(shape)}`);
      expect(shape.icon_role === "img" && shape.icon_label === "Clear" && shape.icon_hidden === null, `the icon was not labeled: ${JSON.stringify(shape)}`);
      expect(JSON.stringify(shape.labels) === JSON.stringify(["Feels like", "High / low", "Humidity", "Rain chance", "Wind"]) && JSON.stringify(shape.values) === JSON.stringify(["8\u00b0", "14\u00b0 / 6\u00b0", "44%", "30%", "12 km/h NW"]), `the stats were wrong: ${JSON.stringify(shape)}`);
      expect(shape.ask, "the location button is missing beside a city reading");
      expect(shape.in_right_half && shape.right_gap < 40 && shape.top_gap < 40, `the card is not in the top-right corner: ${JSON.stringify(shape)}`);
      expect((await weather_requests()) === 0, "a stored reading sent a request");
      if (shot_dir) await take_both_shots("newtab-weather");
    });

    await run_case("the More button opens the detail in place and Less closes it, with no request", async () => {
      expect(await open_new_tab(".weather-more"), "the More button never drew");
      const state = () => in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const button = page.querySelector(".weather-more"); const panel = page.querySelector(".weather-detail"); return { tag: button.tagName, text: button.textContent, expanded: button.getAttribute("aria-expanded"), controls: button.getAttribute("aria-controls") === panel.id, shown: panel.getClientRects().length > 0, facts: [...panel.querySelectorAll(".weather-facts:not(.weather-air) .weather-stat")].map((node) => node.textContent), hours: panel.querySelectorAll(".weather-hour").length }; })()`);
      const closed = await state();
      expect(closed.tag === "BUTTON" && closed.text === "More" && closed.expanded === "false" && closed.controls && !closed.shown, `the closed state was wrong: ${JSON.stringify(closed)}`);
      await in_background(`${NEWTAB_VIEW}.document.querySelector(".weather-more").click()`);
      const open = await state();
      expect(open.text === "Less" && open.expanded === "true" && open.shown, `the open state was wrong: ${JSON.stringify(open)}`);
      expect(JSON.stringify(open.facts) === JSON.stringify(["2UV index", "7:42 AMSunrise", "3:31 PMSunset"]), `the facts were wrong: ${JSON.stringify(open)}`);
      // The strip is one row: the count fits the panel (6 to 11), every column holds four rows, and nothing wraps or scrolls.
      const strip = await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const row = page.querySelector(".weather-hours"); const hours = [...row.querySelectorAll(".weather-hour")]; const panel = page.querySelector(".weather-detail").getBoundingClientRect(); return { count: hours.length, tops: [...new Set(hours.map((hour) => Math.round(hour.getBoundingClientRect().top)))].length, rows: [...new Set(hours.map((hour) => hour.children.length))], icons: hours.filter((hour) => hour.children[1].matches("svg.weather-icon")).length, scrolls: row.scrollWidth > row.clientWidth, inside: hours.every((hour) => { const box = hour.getBoundingClientRect(); return box.left >= panel.left && box.right <= panel.right; }) }; })()`);
      expect(strip.count >= 6 && strip.count <= 11 && strip.tops === 1 && JSON.stringify(strip.rows) === "[4]" && strip.icons === strip.count && !strip.scrolls && strip.inside, `the strip was not one row of four-row hours that fit: ${JSON.stringify(strip)}`);
      const air = await in_background(`[...${NEWTAB_VIEW}.document.querySelectorAll(".weather-air .weather-stat")].map((node) => node.textContent)`);
      expect(JSON.stringify(air) === JSON.stringify(["34 FairAir quality (EU AQI)", "8PM2.5", "15PM10", "70Ozone"]), `the air quality row was wrong: ${JSON.stringify(air)}`);
      if (shot_dir) await take_both_shots("newtab-weather-open");
      await in_background(`${NEWTAB_VIEW}.document.querySelector(".weather-more").click()`);
      const again = await state();
      expect(again.text === "More" && again.expanded === "false" && !again.shown, `the second click did not close it: ${JSON.stringify(again)}`);
      expect((await weather_requests()) === 0, "opening the detail sent a request");
    });

    await run_case("with no stored air quality, a drawn card with the panel closed sends no air quality request and draws no row", async () => {
      await in_background(`browser.storage.local.remove("newtab_net_cache_air")`);
      expect(await open_new_tab(".weather-more"), "the More button never drew");
      await new Promise((done) => setTimeout(done, 1500));
      expect((await weather_requests()) === 0, "the closed panel sent a request to open-meteo");
      expect(await in_background(`!${NEWTAB_VIEW}.document.querySelector(".weather-air")`), "an air quality row drew with no data");
      await in_background(AIR_SEED);
    });

    // Below 61rem the open 22rem panel would reach the centered clock, so the card must sit in its own row. Each width is a same-origin frame, since a key test cannot resize the window.
    for (const width of [360, 800]) {
      await run_case(`in a ${width} px window the card, open or closed, does not overlap the clock, and closed it leaves the clock in place above 32rem`, async () => {
        expect(await open_new_tab(".weather-reading"), "the stored reading never drew");
        await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const frame = page.createElement("iframe"); frame.id = "narrow"; frame.src = "newtab.html?builtin"; frame.style.cssText = "position:fixed;top:0;left:0;width:${width}px;height:720px;border:1px solid red;z-index:10;background:black"; page.body.append(frame); })()`);
        await poll_until("the narrow page to draw the card", async () => (await in_background(`!!${NEWTAB_VIEW}.document.querySelector("#narrow")?.contentDocument?.querySelector(".weather-more")`)).valueOf());
        const measure = () => in_background(`(() => { const inner = ${NEWTAB_VIEW}.document.querySelector("#narrow").contentDocument; const card = inner.querySelector(".weather").getBoundingClientRect(); const clock = inner.querySelector(".time").getBoundingClientRect(); return { view: inner.defaultView.innerWidth, position: inner.defaultView.getComputedStyle(inner.querySelector(".weather")).position, panel_shown: inner.querySelector(".weather-detail").getClientRects().length > 0, card_bottom: card.bottom, clock_top: clock.top, area_top: inner.querySelector(".time-area").getBoundingClientRect().top, page_top: inner.querySelector(".desertfox-newtab").getBoundingClientRect().top, card_right: card.right, card_left: card.left, strip: (() => { const panel = inner.querySelector(".weather-detail").getBoundingClientRect(); const hours = [...inner.querySelectorAll(".weather-hour")].map((hour) => hour.getBoundingClientRect()); return { count: hours.length, rows: new Set(hours.map((box) => Math.round(box.top))).size, inside: hours.every((box) => box.left >= panel.left - 0.5 && box.right <= panel.right + 0.5) }; })() }; })()`);
        const closed = await measure();
        expect(closed.view >= width - 2 && closed.view <= width, `the frame was ${closed.view} wide`);
        expect((width > 512 || (closed.position === "static" && closed.card_bottom <= closed.clock_top)) && closed.card_left >= 0 && closed.card_right <= closed.view, `the closed card overlaps or leaves the window: ${JSON.stringify(closed)}`);
        // Between 32rem and 61rem the closed card stays in the corner, so the clock area starts at the page top as it does without a card.
        if (width > 512) expect(closed.position === "absolute" && closed.area_top - closed.page_top < 2, `the closed card at ${width} px pushed the clock down: ${JSON.stringify(closed)}`);
        if (shot_dir) await take_both_shots(`newtab-weather-${width}`);
        await in_background(`${NEWTAB_VIEW}.document.querySelector("#narrow").contentDocument.querySelector(".weather-more").click()`);
        const open = await measure();
        expect(open.panel_shown && open.card_bottom <= open.clock_top && open.card_left >= 0 && open.card_right <= open.view, `the open card overlaps the clock or leaves the window: ${JSON.stringify(open)}`);
        expect(open.strip.count >= 6 && open.strip.rows === 1 && open.strip.inside, `at ${width} px the strip was not one row of at least 6 hours inside the panel: ${JSON.stringify(open.strip)}`);
        if (shot_dir) await take_both_shots(`newtab-weather-${width}-open`);
        await in_background(`${NEWTAB_VIEW}.document.querySelector("#narrow").remove()`);
      });
    }

    await run_case("f labels the More button, and the open panel at full width clears the clock with every hour shown", async () => {
      expect(await open_new_tab(".weather-more"), "the More button never drew");
      await poll_until("the key handler to start on the new tab page", async () => await in_background(`${NEWTAB_VIEW}.document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`).catch(() => false));
      await wait_view_takes_keys("newtab.html");
      await press_keys("f");
      const labels_near_more = () => in_background(`(() => { const doc = ${NEWTAB_VIEW}.document; const more = doc.querySelector(".weather-more").getBoundingClientRect(); return [...doc.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])]).filter((label) => { const box = label.getBoundingClientRect(); return box.right > more.left - 30 && box.left < more.right + 30 && box.bottom > more.top - 30 && box.top < more.bottom + 30; }).length; })()`);
      await poll_until("a hint label on the More button", async () => (await labels_near_more()) > 0);
      await press_keys("-k", "Escape");
      await in_background(`${NEWTAB_VIEW}.document.querySelector(".weather-more").click()`);
      const wide = await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const panel = page.querySelector(".weather-detail").getBoundingClientRect(); const clock = page.querySelector(".clock").getBoundingClientRect(); const hours = [...page.querySelectorAll(".weather-hour")].map((hour) => hour.getBoundingClientRect()); const inside = hours.filter((box) => box.left >= panel.left && box.right <= panel.right && box.bottom <= panel.bottom + 1).length; return { overlap: panel.left < clock.right && panel.right > clock.left && panel.top < clock.bottom && panel.bottom > clock.top, hours: hours.length, inside }; })()`);
      expect(!wide.overlap, `the open panel covers the clock: ${JSON.stringify(wide)}`);
      expect(wide.hours === wide.inside && wide.hours >= 6, `an hour is clipped or hidden: ${JSON.stringify(wide)}`);
    });

    await use_settings("weather_forget", "newtab_weather = false\n");
    await in_background(WEATHER_SEED);
    await in_background(AIR_SEED);
    await run_case("with newtab_weather off a draw deletes the stored answer and sends nothing", async () => {
      expect(await open_new_tab(".date"), "the page never rendered");
      await poll_until("the stored weather and air quality answers to be deleted", async () => !(await in_background(`browser.storage.local.get(["newtab_net_cache_weather", "newtab_net_cache_air"]).then((found) => "newtab_net_cache_weather" in found || "newtab_net_cache_air" in found)`)));
      expect((await weather_requests()) === 0, "the page requested open-meteo while the setting is off");
    });
  } finally {
    await close_new_tabs().catch(() => undefined);
    await open_page("page", "weather_restore", { new_tab: true });
    await load_config_dir(config_dir);
  }
}
