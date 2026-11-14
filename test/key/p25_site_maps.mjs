// The shipped Maps rows: hjkl send arrow keys to the map while nothing else has focus, and fall through to DesertFox's own keys when another element has focus. The shipped rows match google.com only, so this piece lays the shipped binds on a test address with the site pattern swapped.
// The stand-in map records each keydown it receives while it has focus, as Maps pans only on keys sent to its map element while that element has focus. Beside it sits a focusable panel that scrolls, as the Maps place panel does.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "scroll", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);

export async function run_cases({ config_copy, load_config_dir, setup, on_teardown, run_case, open_page, press_keys, in_active_tab, in_background, wait_event, events, url_of, poll_until, expect, sleep }) {
  await setup("load the shipped Maps binds as a row for the maps_ pages", async () => {
    const shipped = DEFAULT_SITE_ROWS.find(({ name }) => name === "maps")?.row;
    if (!shipped) throw new Error("no shipped site row named maps");
    const dir = config_copy();
    const { site: _site, bind, ...columns } = shipped;
    const column_lines = Object.entries(columns).map(([name, value]) => `${name} = ${toml(value)}`);
    appendFileSync(join(dir, "settings.toml"), ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=maps_*"', `bind = ${toml(bind)}`, ...column_lines, ""].join("\n"));
    await load_config_dir(dir);
  });

  // The controls page brings a field (#first) and enough filler to scroll the page. The field page focuses its field as it loads, as Maps focuses its search box.
  const open_map = async (id, kind = "controls") => {
    await open_page(kind, `maps_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const map = document.createElement("div");
      map.setAttribute("role", "application");
      map.tabIndex = 0;
      map.style.cssText = "width:300px;height:100px";
      document.documentElement.dataset.pan = "";
      map.addEventListener("keydown", (event) => { if (document.activeElement === map) document.documentElement.dataset.pan += event.key + ","; });
      const panel = document.createElement("div");
      panel.id = "panel";
      panel.tabIndex = 0;
      panel.style.cssText = "width:300px;height:150px;overflow:auto";
      panel.innerHTML = '<div style="height:3000px">places</div>';
      document.body.prepend(map, panel);
      return true;
    })()`);
  };
  const pans = () => in_active_tab("document.documentElement.dataset.pan");
  const expect_pans = async (wanted) => {
    await poll_until(`map keys ${wanted}`, async () => (await pans()) === wanted);
    // A bound key must not also scroll, so the page stays at the top.
    await sleep(200);
    expect((await pans()) === wanted, `the map keys changed to ${await pans()}`);
    expect((await in_active_tab("scrollY")) === 0, "a bound key also scrolled the page");
  };
  const focus = (selector) => in_active_tab(`(document.querySelector(${JSON.stringify(selector)}).focus(), document.activeElement === document.querySelector(${JSON.stringify(selector)}))`);

  await run_case("with body focused, h, j, k and l send one arrow each to the map", async () => {
    await open_map("body");
    expect((await in_active_tab("document.activeElement === document.body")) === true, "something other than body has focus");
    await press_keys("j");
    await expect_pans("ArrowDown,");
    await press_keys("hkl");
    await expect_pans("ArrowDown,ArrowLeft,ArrowUp,ArrowRight,");
  });

  await run_case("on a page that focuses its search field as it loads, j pans the map", async () => {
    await open_map("load", "field");
    await poll_until("the field lost the load-time focus", async () => (await in_active_tab('document.activeElement?.id ?? ""')) !== "field");
    await press_keys("j");
    await expect_pans("ArrowDown,");
    expect((await in_active_tab('document.getElementById("field").value')) === "", "j typed into the field");
  });

  await run_case("on a page that builds its map early and focuses its search field late in the load, the map ends up with the focus and j pans", async () => {
    // A script registered for this page adds the map as the document starts, and focuses the field 300 ms after the DOM is read, as Maps does.
    const late_focus = `
      document.addEventListener("DOMContentLoaded", () => {
        const map = document.createElement("div");
        map.setAttribute("role", "application");
        map.tabIndex = 0;
        map.style.cssText = "width:300px;height:100px";
        document.documentElement.dataset.pan = "";
        map.addEventListener("keydown", (event) => { if (document.activeElement === map) document.documentElement.dataset.pan += event.key + ","; });
        document.body.prepend(map);
        setTimeout(() => document.getElementById("first").focus(), 300);
      });`;
    on_teardown(() => in_background(`globalThis.p25_late_focus?.unregister()`));
    await in_background(`browser.contentScripts.register({ matches: ["*://127.0.0.1/controls?id=maps_late*"], runAt: "document_start", js: [{ code: ${JSON.stringify(late_focus)} }] }).then((registered) => { globalThis.p25_late_focus = registered; })`);
    // No key probe: a key gives the page user activation, which ends the load window.
    const mark = events.length;
    await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of("controls", "maps_late"))}, active: true }).then((tab) => tab.id)`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "maps_late", "content script ready on maps_late", 6000);
    const map_focused = 'document.activeElement === document.querySelector(\'div[role="application"]\')';
    await poll_until("the map holds the focus after the load", async () => (await in_active_tab(map_focused)) === true, { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `focus is on ${await in_active_tab('document.activeElement?.id || document.activeElement?.localName')}`));
    await sleep(500);
    expect((await in_active_tab(map_focused)) === true, "the map lost the focus again");
    await press_keys("j");
    await expect_pans("ArrowDown,");
    expect((await in_active_tab('document.getElementById("first").value')) === "", "j typed into the field");
  });

  await run_case("with the map focused, j pans the map", async () => {
    await open_map("focused");
    expect(await focus('div[role="application"]'), "the map took no focus");
    await press_keys("j");
    await expect_pans("ArrowDown,");
  });

  await run_case("after Escape blurs the focused map, j focuses it again and pans", async () => {
    await open_map("escape");
    expect(await focus('div[role="application"]'), "the map took no focus");
    await press_keys("-k", "Escape");
    await poll_until("Escape blurred the map", async () => (await in_active_tab("document.activeElement === document.body")) === true);
    await press_keys("j");
    await expect_pans("ArrowDown,");
  });

  await run_case("a count sends the arrow that many times", async () => {
    await open_map("count");
    await press_keys("5j");
    await expect_pans("ArrowDown,ArrowDown,ArrowDown,ArrowDown,ArrowDown,");
  });

  await run_case("with the panel focused, j and 5j scroll the panel and leave the map alone", async () => {
    await open_map("panel");
    expect(await focus("#panel"), "the panel took no focus");
    await press_keys("j");
    await poll_until("the panel scrolled", async () => (await in_active_tab('document.getElementById("panel").scrollTop')) > 0);
    const after_one = await in_active_tab('document.getElementById("panel").scrollTop');
    await press_keys("5j");
    await poll_until("the panel scrolled further", async () => (await in_active_tab('document.getElementById("panel").scrollTop')) > after_one);
    await sleep(200);
    expect((await pans()) === "", `a key reached the map: ${await pans()}`);
  });

  await run_case("other keys are unaffected: G and gg still move the page and send nothing to the map", async () => {
    await open_map("other");
    await press_keys("G");
    await poll_until("the page went to the bottom", async () => (await in_active_tab("scrollY")) > 0);
    await press_keys("gg");
    await poll_until("the page went back to the top", async () => (await in_active_tab("scrollY")) === 0);
    await sleep(200);
    expect((await pans()) === "", `a key reached the map: ${await pans()}`);
  });

  await run_case("in insert mode in a field, j types and sends nothing to the map", async () => {
    await open_map("field");
    expect(await focus("#first"), "the field took no focus");
    await press_keys("j");
    await poll_until("the field holds j", async () => (await in_active_tab('document.getElementById("first").value')) === "j");
    await sleep(200);
    expect((await pans()) === "", `a key reached the map: ${await pans()}`);
  });
}
