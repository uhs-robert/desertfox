// Space and Enter in item mode. Space toggles the checkbox of the current item (a native one, a role=checkbox div, and with a site row's `target` a plain span) and shows a notice on an item with none. Enter opens the item's link, also after Space moved the focus into the item. A row's `target` replaces the generic search.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles", "hints"];

export async function run_cases({ run_line, config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("bind Space on the ia_star_ pages to the span a site names", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=ia_star_*"', 'keymap = { item = { "<Space>" = "page.item_action --action=toggle --target=.star" } }', "", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=ia_miss_*"', 'keymap = { item = { j = "page.item --direction=down --link=a.nothing div.card" } }', ""].join("\n"));
    await load_config_dir(dir);
  });

  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const expect_badge = (label) => poll_until(`the ${label} badge`, async () => (await badge()) === label);
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const toggled = () => in_active_tab("document.documentElement.dataset.toggled ?? ''");
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
  const hash = () => in_active_tab("location.hash");
  const open_boxes = async (id) => {
    await open_page("item_list", `${id}_boxes`, { new_tab: true });
    await press_keys("I");
    await expect_badge("ITEM");
    await expect_focus("c0");
  };

  await run_case("Space toggles the native checkbox of the current item and the role checkbox of the next", async () => {
    await open_boxes("ia_generic");
    await press_keys("-k", "space");
    await poll_until("the native box clicked", async () => (await toggled()) === "box0");
    await press_keys("j");
    await expect_focus("c1");
    await press_keys("-k", "space");
    await poll_until("the role box clicked", async () => (await toggled()) === "box0,box1");
  });

  await run_case("Space on an item with no checkbox shows the notice and clicks nothing", async () => {
    await open_boxes("ia_none");
    await press_keys("3j");
    await expect_focus("c3");
    await press_keys("-k", "space");
    await poll_until("the notice", async () => (await toast_text()).includes("No checkbox in this item"));
    expect((await toggled()) === "", `Space clicked ${await toggled()}`);
  });

  await run_case("Enter opens the link of the current item, also after Space moved the focus into the item", async () => {
    await open_boxes("ia_enter");
    await press_keys("-k", "space");
    await poll_until("the native box clicked", async () => (await toggled()) === "box0");
    // The click moved the focus onto the checkbox, so a native Enter would do nothing.
    await expect_focus("box0");
    await press_keys("-k", "Return");
    await poll_until("the link opened", async () => (await hash()) === "#c0");
    await press_keys("j");
    await expect_focus("c1");
    await press_keys("-k", "Return");
    await poll_until("the second link opened", async () => (await hash()) === "#c1");
  });

  await run_case("a site row's target replaces the generic search, so Space clicks the span", async () => {
    await open_boxes("ia_star");
    await press_keys("jj");
    await expect_focus("c2");
    await press_keys("-k", "space");
    await poll_until("the span clicked", async () => (await toggled()) === "box2");
    await sleep(200);
    expect((await toggled()) === "box2", `Space clicked ${await toggled()}`);
  });

  // Auto-start and `mode item` record no move. The focused item is still the current one.
  await run_case("Enter opens a link reached with focus before any move", async () => {
    await open_page("item_list", "ia_tab", { new_tab: true });
    await run_line("mode item");
    await expect_badge("ITEM");
    await in_active_tab(`document.getElementById("c3").focus(); 0`);
    await press_keys("-k", "Return");
    await poll_until("the link opened", async () => (await hash()) === "#c3");
  });

  await run_case("a row's link selector that finds nothing means no link, not the first link of the item", async () => {
    await open_page("item_list", "ia_miss_a", { new_tab: true });
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("j");
    // The row's link is missing, so the card itself takes the focus.
    await poll_until("the card focused", async () => (await in_active_tab(`document.activeElement?.className ?? ""`)) === "card");
    await press_keys("-k", "Return");
    await poll_until("the notice", async () => (await toast_text()).includes("This item has no link"));
    expect((await hash()) === "", `Enter opened ${await hash()}`);
  });

  await run_case("f labels only the current item, so a hint pick clicks inside it", async () => {
    await open_boxes("ia_scope");
    await press_keys("jj");
    await expect_focus("c2");
    const labels = () => in_active_tab(`[...document.documentElement.children].reduce((sum, child) => sum + (child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint").length ?? 0), 0)`);
    await press_keys("f");
    await poll_until("the labels", async () => (await labels()) > 0);
    // The card holds its title link and the star span.
    expect((await labels()) >= 1 && (await labels()) <= 3, `${await labels()} labels`);
    await press_keys("-k", "Escape");
  });
}
