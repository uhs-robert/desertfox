// scroll_selector: a site row names the inner element that j scrolls, and a page the row does not name scrolls the page.
// The row lives in a config copy, so no other piece sees it. Each page gets an inner overflow box, which the page scroll never moves.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["scroll", "config"];

const PANE = `const pane = document.createElement("div"); pane.id = "site-pane"; pane.style.cssText = "height:200px;overflow:auto"; pane.innerHTML = '<div style="height:3000px"></div>'; document.body.prepend(pane); true`;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, expect, sleep }) {
  await setup("load a config with a scroll_selector for the sscroll_ pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=sscroll_ruled*"\nscroll_selector = "#site-pane"\n');
    await load_config_dir(dir);
  });

  const positions = () => in_active_tab(`[document.getElementById("site-pane").scrollTop, document.scrollingElement.scrollTop]`);

  const press_j_on = async (page_id) => {
    await open_page("aligned", page_id, { new_tab: true });
    expect((await in_active_tab(PANE)) === true, "the pane was not added");
    await press_keys("j");
    await sleep(400);
    return positions();
  };

  await run_case("j scrolls the selected inner box and not the page", async () => {
    const [pane_top, page_top] = await press_j_on("sscroll_ruled");
    expect(pane_top > 0 && page_top === 0, `pane ${pane_top}, page ${page_top}`);
  });

  await run_case("a page with no row scrolls the page and leaves the box", async () => {
    const [pane_top, page_top] = await press_j_on("sscroll_plain");
    expect(pane_top === 0 && page_top > 0, `pane ${pane_top}, page ${page_top}`);
  });
}
