// The shipped search rows on a test address with the site pattern swapped: kagi passes j and k to the page, brave turns them into arrow keys.
// The stand-in page records every keydown that reaches it, with whether the browser made it (`trusted`), so a passed key and a sent arrow show apart.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const ENGINES = ["kagi", "brave"];

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load the shipped kagi and brave rows for the search_ pages", async () => {
    const dir = config_copy();
    const lines = [];
    for (const name of ENGINES) {
      const shipped = DEFAULT_SITE_ROWS.find((entry) => entry.name === name)?.row;
      if (!shipped) throw new Error(`no shipped site row named ${name}`);
      const { site: _site, ...columns } = shipped;
      lines.push("", "[[site_rules]]", `site = "*://127.0.0.1/*?id=search_${name}*"`, ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`));
    }
    appendFileSync(join(dir, "settings.toml"), [...lines, ""].join("\n"));
    await load_config_dir(dir);
  });

  const open_search = async (name) => {
    await open_page("controls", `search_${name}`, { new_tab: true });
    await in_active_tab(`(() => {
      document.documentElement.dataset.keys = "";
      addEventListener("keydown", (event) => { document.documentElement.dataset.keys += event.key + (event.isTrusted ? "" : "!") + ","; });
      document.body.style.minWidth = "5000px";
      document.activeElement?.blur();
      return true;
    })()`);
  };
  const keys = () => in_active_tab("document.documentElement.dataset.keys");
  const expect_keys = async (wanted) => {
    await poll_until(`page keys ${wanted}`, async () => (await keys()) === wanted);
    await sleep(200);
    expect((await keys()) === wanted, `the page keys changed to ${await keys()}`);
    expect((await in_active_tab("scrollY")) === 0, "a passed or sent key also scrolled the page");
  };

  await run_case("on a page with no search row, j scrolls down, so the zero scroll on the rows below means something", async () => {
    await open_search("none");
    await press_keys("j");
    await poll_until("j scrolled the page", async () => (await in_active_tab("scrollY")) > 0);
    expect((await keys()) === "", `j reached the page: ${await keys()}`);
  });

  await run_case("on kagi, j and k reach the page as the browser's own keys", async () => {
    await open_search("kagi");
    await press_keys("jkj");
    await expect_keys("j,k,j,");
  });

  await run_case("on kagi, h and l stay DesertFox's and do not reach the page", async () => {
    await open_search("kagi");
    await press_keys("hl", "j");
    await expect_keys("j,");
  });

  await run_case("on kagi, h and l scroll the page sideways", async () => {
    await open_search("kagi");
    await press_keys("l");
    await poll_until("l scrolled right", async () => (await in_active_tab("scrollX")) > 0);
    await press_keys("h");
    await poll_until("h scrolled back", async () => (await in_active_tab("scrollX")) === 0);
    expect((await keys()) === "", `h or l reached the page: ${await keys()}`);
  });

  await run_case("on brave, j and k send untrusted arrow keys and no j or k reaches the page", async () => {
    await open_search("brave");
    await press_keys("jk");
    await expect_keys("ArrowDown!,ArrowUp!,");
  });

  await run_case("on brave, a count sends that many arrows", async () => {
    await open_search("brave");
    await press_keys("3j");
    await expect_keys("ArrowDown!,ArrowDown!,ArrowDown!,");
  });
}
