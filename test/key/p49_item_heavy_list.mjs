// The item finder (`item_navigator = true`) on a long list: a content script reads a page of about 6000 elements past the 40 ms of a later read. The first read of a page has a longer budget, so a press of j walks the list, after a pause at most, instead of scrolling.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles"];

const CARDS = 500;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load a config with item_navigator on", async () => {
    const dir = config_copy();
    const file = join(dir, "settings.toml");
    // A top-level setting goes above the first table.
    writeFileSync(file, `item_navigator = true\n${readFileSync(file, "utf8")}`);
    await load_config_dir(dir);
  });

  await run_case("on a long list a press of j focuses the title link of the first card", async () => {
    await open_page("page", "finder_heavy", { new_tab: true });
    await in_active_tab(`(() => {
      const card = (index) => '<div class="card" style="margin:0 0 20px 20px;width:500px"><h3 style="margin:0"><a id="f' + index + '" href="#f' + index + '">Finder result number ' + index + ' title</a></h3><div class="meta">' + '<span class="tag">tag</span>'.repeat(8) + '</div><span class="snippet">snippet ' + index + '</span></div>';
      const list = document.createElement("div");
      list.innerHTML = Array.from({ length: ${CARDS} }, (_, index) => card(index)).join("");
      document.body.prepend(list);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      // A real page is laid out before the user presses a key, so the first read does not pay for the layout of the new cards.
      return document.body.getBoundingClientRect().height;
    })()`);
    await sleep(300);
    let walked = false;
    for (let press = 0; press < 3 && !walked; press++) {
      await press_keys("j");
      walked = await poll_until("the focus on the first card", async () => (await in_active_tab("document.activeElement?.id ?? ''")) === "f0", { timeout_ms: 1500, expected_timeout: true }).then(() => true, () => false);
    }
    expect(walked, "three presses of j did not reach the first card of a long list");
  });
}
