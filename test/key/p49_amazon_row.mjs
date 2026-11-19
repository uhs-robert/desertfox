// The shipped amazon row on a test address with the site pattern swapped, over a stand-in results grid of three columns: a sponsored tile, a full-width widget between two runs of tiles, and a link around the title with an image link first. hjkl walk the grid across the widget and skip the sponsored tile, gg and G go to the first and last result, and Enter opens the title link.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until }) {
  await setup("load the shipped amazon row for the amazon_ pages", async () => {
    const dir = config_copy();
    const { site: _site, ...columns } = DEFAULT_SITE_ROWS.find((entry) => entry.name === "amazon").row;
    const lines = ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=amazon_*"', ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`), ""];
    appendFileSync(join(dir, "settings.toml"), lines.join("\n"));
    await load_config_dir(dir);
  });

  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);

  // Tiles a0 (sponsored), o0 to o4, a full-width widget, then o5 to o7: o0 o1 on the first row after the ad, o2 o3 o4 on the second, o5 o6 o7 below the widget.
  const tile = (id, ad) => `<div data-component-type="s-search-result" class="${ad ? "AdHolder" : ""}" style="width:100px;height:60px;margin:0 10px 40px 0"><a class="s-no-outline" tabindex="-1" href="#img_${id}" style="display:block;height:20px">image</a><div data-cy="title-recipe"><a id="${id}" href="#${id}" style="display:block;height:20px"><h2>title ${id}</h2></a></div></div>`;
  const open_grid = async (id) => {
    await open_page("controls", `amazon_${id}`, { new_tab: true });
    await press_keys("I");
    await in_active_tab(`(() => {
      const slot = document.createElement("div");
      slot.style.cssText = "display:flex;flex-wrap:wrap;width:330px";
      slot.innerHTML = ${JSON.stringify(tile("a0", true) + ["o0", "o1", "o2", "o3", "o4"].map((name) => tile(name, false)).join("") + '<div data-component-type="s-searchgrid-carousel" style="width:100%;height:60px;margin-bottom:40px"><a href="#carousel"><h2>carousel</h2></a></div>' + ["o5", "o6", "o7"].map((name) => tile(name, false)).join(""))};
      document.body.prepend(slot);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };

  await run_case("l and h walk a row, j and k step by column across the widget, and the sponsored tile is skipped", async () => {
    await open_grid("walk");
    await press_keys("l");
    await expect_focus("o0");
    await press_keys("l");
    await expect_focus("o1");
    await press_keys("j");
    await expect_focus("o4");
    await press_keys("j");
    await expect_focus("o7");
    await press_keys("k");
    await expect_focus("o4");
    await press_keys("h");
    await expect_focus("o3");
  });

  await run_case("G goes to the last result and gg to the first organic one", async () => {
    await open_grid("ends");
    await press_keys("G");
    await expect_focus("o7");
    await press_keys("gg");
    await expect_focus("o0");
  });

  await run_case("Enter opens the title link, not the image link", async () => {
    await open_grid("enter");
    await press_keys("l");
    await expect_focus("o0");
    await press_keys("-k", "Return");
    await poll_until("the address to name the title link", async () => (await in_active_tab("location.hash")) === "#o0");
  });
}
