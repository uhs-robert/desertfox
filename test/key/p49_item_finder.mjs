// The item finder (`item_finder = true`): on a page with no site row, j and k walk the list the finder reads from the page, with the box and the focus on the title link, and Enter opens it. On a page with no list the keys scroll as they do without the setting. A shipped row for the site still decides first. The bundle-refused fallback is covered in test/content/item_finder_fallback.test.ts, because no real page makes the item bundle fail without a test hook.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles"];

const CARDS = 10;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load a config with item_finder on", async () => {
    const dir = config_copy();
    const file = join(dir, "settings.toml");
    // A top-level setting goes above the first table.
    writeFileSync(file, `item_finder = true\n${readFileSync(file, "utf8")}`);
    await load_config_dir(dir);
  });

  // Ten cards, each with a title link in a heading, stacked on a page that has no row and no `main`.
  const add_cards = (count = CARDS) =>
    in_active_tab(`(() => {
      const list = document.createElement("div");
      list.innerHTML = ${JSON.stringify(Array.from({ length: count }, (_, index) => `<div class="card" style="height:100px;margin:0 0 20px 20px;width:500px"><h3 style="margin:0"><a id="f${index}" href="#f${index}">Finder result number ${index} title</a></h3><span>snippet ${index}</span></div>`).join(""))};
      document.body.prepend(list);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  // A loaded machine can run the finder past its time budget on the first press, which answers none and scrolls. So the first press repeats, once the none answer is old, until a card has the focus. The press only repeats while no card holds it.
  const press_j_until_a_card_has_focus = () =>
    poll_until("a card to take the focus", async () => {
      if (!(await focused()).startsWith("f")) await press_keys("j");
      return (await focused()).startsWith("f");
    }, { timeout_ms: 8000 });
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const READ_BOX = `(() => {
    for (const child of document.documentElement.children) {
      const box = child.openOrClosedShadowRoot?.querySelector(".desertfox-item-box");
      if (!box) continue;
      const rect = box.getBoundingClientRect();
      return child.isConnected && box.style.visibility !== "hidden" ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    }
    return null;
  })()`;
  const card_rect = (id) => in_active_tab(`(() => { const r = document.getElementById(${JSON.stringify(id)}).closest(".card").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const near = (a, b) => ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1.5);

  // The helper may press j more than once on a loaded machine, so each case reads which card took the focus and counts from there.
  const index_of_focus = async () => Number((await focused()).slice(1));

  await run_case("j focuses the title link of a card, j goes on to the next and k goes back", async () => {
    await open_page("page", "finder_walk", { new_tab: true });
    await add_cards();
    await press_j_until_a_card_has_focus();
    const first = await index_of_focus();
    await press_keys("j");
    await expect_focus(`f${first + 1}`);
    await press_keys("k");
    await expect_focus(`f${first}`);
  });

  await run_case("the box sits on the card and moves with it", async () => {
    await open_page("page", "finder_box", { new_tab: true });
    await add_cards();
    await press_j_until_a_card_has_focus();
    const first = await index_of_focus();
    const box_on = (index) => poll_until(`the box on card ${index}`, async () => { const drawn = await in_active_tab(READ_BOX); return drawn !== null && near(drawn, await card_rect(`f${index}`)); });
    await box_on(first);
    await press_keys("j");
    await box_on(first + 1);
  });

  await run_case("Enter opens the focused link", async () => {
    await open_page("page", "finder_enter", { new_tab: true });
    await add_cards();
    await press_j_until_a_card_has_focus();
    const id = await focused();
    await press_keys("-k", "Return");
    await poll_until("the address to name the focused card", async () => (await in_active_tab("location.hash")) === `#${id}`);
  });

  await run_case("a page with no list scrolls on j and moves no focus", async () => {
    await open_page("page", "finder_none", { new_tab: true });
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab("scrollY")) > 0);
    expect((await focused()) === "", "j moved the focus on a page with no list");
    expect((await in_active_tab(READ_BOX)) === null, "a box showed on a page with no list");
  });

  await run_case("a page whose list grows after a none answer is read again, and the list is walked", async () => {
    await open_page("page", "finder_late", { new_tab: true });
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab("scrollY")) > 0);
    // The none answer stands for half a second, so the list comes after that.
    await sleep(1000);
    await add_cards();
    await press_j_until_a_card_has_focus();
  });
}
