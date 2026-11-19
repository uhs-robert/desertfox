// Site row binds guarded by `when_present`. The shipped google row on a test address: gg and G go to the first and last result, and on a page that shows no result they keep the plain scroll to the top and bottom. A user row with a choice list: one key does one thing while a grid shows and another while a list shows, as two views toggled by a button, and the plain key once neither shows.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const ITEMS = 6;
const GRID = "ul.grid li.tile";
const LIST = "table.list tr.row";

export async function run_cases({ run_line, config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  // The command line enters item mode on any page, with or without a list. The key after it lands in item mode once the badge says ITEM.
  const enter_item_mode = async () => {
    await run_line("mode item");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
  };
  await setup("load the shipped google row for the ends_ pages and a row with a choice list on l for the views_ pages", async () => {
    const dir = config_copy();
    const { site: _site, ...columns } = DEFAULT_SITE_ROWS.find((entry) => entry.name === "google").row;
    const lines = ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=ends_*"', ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`)];
    lines.push("", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=views_*"', `bind = { l = [{ run = "page.item --direction=right ${GRID}", when_present = "${GRID}" }, { run = "page.item --direction=first ${LIST}", when_present = "${LIST}" }] }`);
    appendFileSync(join(dir, "settings.toml"), [...lines, ""].join("\n"));
    await load_config_dir(dir);
  });

  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);

  // Google shaped result blocks above the controls page's tall filler, so the page scrolls well past the last result. `style` hides every block when given.
  const open_results = async (id, style = "") => {
    await open_page("controls", `ends_${id}`, { new_tab: true });
    await enter_item_mode();
    await in_active_tab(`(() => {
      const search = document.createElement("div");
      search.id = "search";
      search.innerHTML = ${JSON.stringify(Array.from({ length: ITEMS }, (_, index) => `<div class="MjjYud" style="height:60px;margin-bottom:40px;${style}"><a id="r${index}" href="#r${index}" style="display:block"><h3>result ${index}</h3></a></div>`).join(""))};
      document.body.prepend(search);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };

  await run_case("G focuses the last result and gg the first, wherever the focus was", async () => {
    await open_results("walk");
    await press_keys("jj");
    await expect_focus("r1");
    await press_keys("G");
    await expect_focus(`r${ITEMS - 1}`);
    await press_keys("gg");
    await expect_focus("r0");
  });

  await run_case("gg records the place it leaves, so <C-o> scrolls back there", async () => {
    await open_results("jump");
    await in_active_tab("window.scrollTo(0, 3000); 0");
    await poll_until("the page to scroll down", async () => (await in_active_tab("scrollY")) === 3000);
    await press_keys("gg");
    await expect_focus("r0");
    await poll_until("gg to bring the first result into view", async () => (await in_active_tab("scrollY")) < 3000);
    await press_keys("-M", "ctrl", "o", "-m", "ctrl");
    await poll_until("<C-o> to go back to where gg left", async () => (await in_active_tab("scrollY")) === 3000);
  });

  await run_case("on a matched page with no result, G and gg scroll to the bottom and the top", async () => {
    await open_page("controls", "ends_empty", { new_tab: true });
    await enter_item_mode();
    await press_keys("G");
    await poll_until("G scrolled to the bottom", async () => (await in_active_tab("scrollY")) > 1000);
    await press_keys("gg");
    await poll_until("gg scrolled back to the top", async () => (await in_active_tab("scrollY")) === 0);
  });

  await run_case("results that are all hidden count as none, so G and gg still scroll", async () => {
    await open_results("hidden", "visibility:hidden");
    await press_keys("G");
    await poll_until("G scrolled to the bottom", async () => (await in_active_tab("scrollY")) > 1000);
    expect((await focused()) === "", `G focused ${await focused()}`);
    await press_keys("gg");
    await poll_until("gg scrolled back to the top", async () => (await in_active_tab("scrollY")) === 0);
  });

  // A grid of tiles and a list of rows, one shown at a time, and a toggle button between them that keeps the focus after a click, as Google Drive's view toggle does. The page is wide, so the plain l has room to scroll right.
  const open_views = async (id) => {
    await open_page("controls", `views_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const views = document.createElement("div");
      views.innerHTML = '<button id="toggle">view</button>' +
        '<ul class="grid" style="display:flex;gap:10px;list-style:none;padding:0">' + [0, 1, 2].map((index) => '<li class="tile" id="t' + index + '" tabindex="0" style="width:100px;height:80px">tile ' + index + '</li>').join("") + '</ul>' +
        '<table class="list" style="display:none">' + [0, 1, 2].map((index) => '<tr class="row" id="w' + index + '" tabindex="0"><td>row ' + index + '</td></tr>').join("") + '</table>' +
        '<div style="width:5000px;height:1px"></div>';
      document.body.prepend(views);
      const grid = views.querySelector("ul.grid");
      const list = views.querySelector("table.list");
      views.querySelector("#toggle").addEventListener("click", () => {
        const to_list = grid.style.display !== "none";
        grid.style.display = to_list ? "none" : "flex";
        list.style.display = to_list ? "table" : "none";
      });
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };
  const toggle = () => in_active_tab(`(() => { const button = document.getElementById("toggle"); button.focus(); button.click(); return true; })()`);

  await run_case("a choice list runs the grid choice while the grid shows and the list choice after the toggle", async () => {
    await open_views("toggle");
    await press_keys("l");
    await expect_focus("t0");
    await press_keys("l");
    await expect_focus("t1");
    await toggle();
    await expect_focus("toggle");
    // The grid still sits in the page, hidden, so only the visibility rule sends l to the list choice.
    await press_keys("l");
    await expect_focus("w0");
    await toggle();
    await press_keys("l");
    await expect_focus("t0");
  });

  await run_case("with neither view shown, l runs the plain key and scrolls right", async () => {
    await open_views("none");
    await in_active_tab(`(() => { document.querySelector("ul.grid").style.display = "none"; return true; })()`);
    await press_keys("l");
    await poll_until("l scrolled the page right", async () => (await in_active_tab("scrollX")) > 0);
    await sleep(100);
    expect((await focused()) === "", `l focused ${await focused()}`);
  });
}
