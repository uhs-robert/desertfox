// Space, Enter and Tab in item mode. Space toggles the checkbox of the current item (a native one, a role=checkbox div, and with a site row's `target` a plain span) and shows a notice on an item with none. Enter opens the item's link, also after Space moved the focus into the item. A row's `target` replaces the generic search.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles", "hints"];

export async function run_cases({ run_line, config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep, in_background }) {
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

  await run_case("Ctrl+Enter opens the current item in a background tab and keeps this tab where it is", async () => {
    await open_boxes("ia_ctrl_enter");
    await press_keys("j");
    await expect_focus("c1");
    await press_keys("-M", "ctrl", "-k", "Return", "-m", "ctrl");
    await poll_until("the item open in a background tab", async () => (await in_background(`(async () => (await browser.tabs.query({})).filter((tab) => tab.url.includes("id=ia_ctrl_enter_boxes") && tab.url.endsWith("#c1")).length)()`)) === 1);
    expect((await hash()) === "", "the current tab moved");
    await expect_badge("ITEM");
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

  const shift_tab = () => press_keys("-M", "shift", "-k", "Tab", "-m", "shift");

  await run_case("Tab and Shift-Tab step through the item's controls, wrap both ways and stay in the item", async () => {
    await open_boxes("ia_tab_ring");
    await press_keys("-k", "Tab");
    await expect_focus("box0");
    await press_keys("-k", "Tab");
    await expect_focus("c0");
    await shift_tab();
    await expect_focus("box0");
    await shift_tab();
    await expect_focus("c0");
    // The box stays on the first item the whole time.
    expect((await in_active_tab(`document.activeElement.closest(".card") === document.querySelector(".card")`)) === true, "the focus left the item");
  });

  await run_case("Enter clicks the control that Tab focused, and j puts the focus back on the next item's link", async () => {
    await open_boxes("ia_tab_enter");
    await press_keys("-k", "Tab");
    await expect_focus("box0");
    await press_keys("-k", "Return");
    await poll_until("the box clicked", async () => (await toggled()) === "box0");
    expect((await hash()) === "", `Enter opened ${await hash()}`);
    await press_keys("j");
    await expect_focus("c1");
    await press_keys("-k", "Tab");
    await expect_focus("box1");
    await press_keys("j");
    await expect_focus("c2");
  });

  await run_case("Tab passes over a text field of the item, so it never starts insert mode", async () => {
    await open_page("item_list", "ia_tfield", { new_tab: true });
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("5j");
    await expect_focus("c5");
    // The card holds its link and a text field, so the ring is the link alone and Tab goes on to the next link.
    await press_keys("-k", "Tab");
    await expect_focus("c6");
    await expect_badge("ITEM");
  });

  await run_case("an item with only its link lets Tab go on to the next link, as the browser does", async () => {
    await open_boxes("ia_tab_single");
    await press_keys("3j");
    await expect_focus("c3");
    await press_keys("-k", "Tab");
    await expect_focus("c4");
    await shift_tab();
    await expect_focus("c3");
    // Each Tab goes on from where the focus is, so the second one does not pick the same link again.
    await press_keys("-k", "Tab");
    await expect_focus("c4");
    await press_keys("-k", "Tab");
    await expect_focus("c5");
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
    // Ctrl+Enter takes the same rule: no row link, no tab, and the first link of the card stays shut.
    await press_keys("-M", "ctrl", "-k", "Return", "-m", "ctrl");
    await poll_until("the notice again", async () => (await toast_text()).includes("No link to open"));
    expect((await in_background(`(async () => (await browser.tabs.query({})).filter((tab) => tab.url.includes("id=ia_miss_a")).length)()`)) === 1, "Ctrl+Enter opened a tab");
  });

  await run_case("f labels the page, and the current item's targets take the first labels", async () => {
    await open_boxes("ia_scope");
    await press_keys("jj");
    await expect_focus("c2");
    const link_top = Number(await in_active_tab(`document.getElementById("c2").getBoundingClientRect().top`));
    const tops = () => in_active_tab(`JSON.stringify([...document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])].map((node) => node.getBoundingClientRect().top)))`).then((text) => JSON.parse(text));
    await press_keys("f");
    await poll_until("the labels", async () => (await tops()).length > 3);
    // The card holds its title link and the star span, and they come first.
    const found = await tops();
    expect(Math.abs(found[0] - link_top) < 40, `the first label sits at ${found[0]}, the item's link at ${link_top}`);
    await press_keys("-k", "Escape");
  });
}
