// hint_add and hint_remove: a site row adds elements to the hint labels and drops others, and a page the row does not name keeps the usual labels.
// The row lives in a config copy, so no other piece sees it. Each page gets two plain boxes that no filter labels on its own.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["hints", "config"];

const TILES = `for (const name of ["tile one", "tile two"]) { const tile = document.createElement("div"); tile.className = "hsite-tile"; tile.textContent = name; tile.style.cssText = "width:120px;height:24px"; document.body.prepend(tile); } true`;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, poll_until, hint_label_count, in_active_tab, expect, sleep }) {
  await setup("load a config with hint selectors for the hsite_ pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=hsite_*"\nhint_add = [".hsite-tile"]\nhint_remove = [\'a[href$="hint_two"]\']\n');
    await load_config_dir(dir);
  });

  // The labels f shows once they stop changing, then Escape.
  const labels_after_f = async (page_id) => {
    await open_page("hints", page_id, { new_tab: true });
    expect((await in_active_tab(TILES)) === true, "the tiles were not added");
    await press_keys("f");
    await poll_until(`the hint labels on ${page_id}`, async () => (await hint_label_count()) > 0);
    await sleep(150);
    const count = await hint_label_count();
    await press_keys("-k", "Escape");
    await poll_until(`the labels to go on ${page_id}`, async () => (await hint_label_count()) === 0);
    return count;
  };

  await run_case("a site row labels its hint_add boxes and drops its hint_remove link, and a page with no row does not", async () => {
    const plain = await labels_after_f("hplain");
    const ruled = await labels_after_f("hsite_ruled");
    // Two tiles added, one link removed.
    expect(ruled === plain + 1, `labels with the row ${ruled}, without ${plain}`);
  });
}
