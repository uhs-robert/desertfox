// The item_navigator setting means that list pages start in item mode: when a page with a list has loaded, the badge says ITEM with no key pressed. A page with no list stays in normal mode, Escape leaves item mode for good on that page, a key pressed before the load completes keeps the page in normal mode, and a site row that sets the setting to false keeps its page in normal mode.
// A page that should start opens without the key probe, since any key pressed before the start wins over it. The probe runs once the badge says ITEM.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROW_ITEMS_WAIT_MS } from "../../src/content/item/start.ts";

export const areas = ["keys", "config", "bundles"];

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep, in_background, events, wait_event, url_of, settle_focus }) {
  await setup("load a config with item_navigator on and a row that turns it off for the is_off pages", async () => {
    const dir = config_copy();
    const file = join(dir, "settings.toml");
    // A top-level setting goes above the first table.
    writeFileSync(file, `item_navigator = true\n${readFileSync(file, "utf8")}`);
    appendFileSync(file, '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=is_off*"\nitem_navigator = false\n');
    // A row that names its items, as the shipped rows do, for the pages that draw them late.
    appendFileSync(file, '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=is_late*"\nitem_navigator = "shipped"\nkeymap.item.j = { id = "page.item", args = { selector = "div.late", direction = "down" } }\n');
    await load_config_dir(dir);
  });

  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const expect_badge = (label) => poll_until(`the ${label} badge`, async () => (await badge()) === label, { timeout_ms: 5000 });
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const open_untouched = async (kind, id) => {
    const mark = events.length;
    await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of(kind, id))}, active: true }).then((tab) => tab.id)`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 6000);
  };
  const expect_started = async (id) => {
    await expect_badge("ITEM");
    await settle_focus({ keys_page_id: id });
  };

  await run_case("a page with a list starts in item mode, and j walks it with no I", async () => {
    await open_untouched("item_list", "is_list");
    await expect_started("is_list");
    await press_keys("j");
    await poll_until("focus on c0", async () => (await focused()) === "c0");
  });

  await run_case("Escape leaves item mode and the page does not start it again", async () => {
    await open_untouched("item_list", "is_escape");
    await expect_started("is_escape");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    // The start waits for an idle moment and checks once, so a second one would come within this time.
    await sleep(2500);
    expect((await badge()) === "NORMAL", `item mode came back, the badge is ${await badge()}`);
    await press_keys("I");
    await expect_badge("ITEM");
  });

  await run_case("Escape pressed before the load completes keeps the page in normal mode", async () => {
    // Opened without the probe: the probe key, as every key that is not Escape, gives user activation, which the start already reads. Escape gives none, and content.js takes it, so the page reports nothing: the presses come after the first moments that drop keys, and a lost press shows as a start.
    await open_untouched("item_list", "is_key_first_slow");
    await poll_until("the page to hold the focus", async () => (await in_active_tab("document.hasFocus()")) === true);
    for (let press = 0; press < 3; press++) {
      await sleep(150);
      await press_keys("-k", "Escape");
    }
    expect((await in_active_tab("document.readyState")) !== "complete", "the load completed before the key, so the case tests nothing");
    expect((await in_active_tab("navigator.userActivation.hasBeenActive")) === false, "Escape gave user activation");
    await poll_until("the load to complete", async () => (await in_active_tab("document.readyState")) === "complete", { timeout_ms: 5000 });
    await sleep(2500);
    expect((await badge()) === "NORMAL", `the page started item mode after a key, the badge is ${await badge()}`);
  });

  // Drive draws its files well after the load completes. The start looks for the row's items for about 5 s.
  const draw_late_items = () => in_active_tab(`(() => { const cards = Array.from({ length: 10 }, (_, index) => '<div class="late" style="height:80px;width:500px;margin:0 0 20px 20px"><a id="l' + index + '" href="#l' + index + '">Late result ' + index + '</a></div>').join(""); document.body.insertAdjacentHTML("afterbegin", cards); return 0; })()`);
  await run_case("a row's items drawn 2 s after the load start item mode", async () => {
    await open_untouched("page", "is_late_draw");
    await poll_until("the load to complete", async () => (await in_active_tab("document.readyState")) === "complete");
    await sleep(2000);
    expect((await badge()) === "NORMAL", `the badge is ${await badge()} before the items exist`);
    await draw_late_items();
    await expect_started("is_late_draw");
    await press_keys("j");
    await poll_until("focus on l0", async () => (await focused()) === "l0");
  });

  await run_case("a key pressed while the start waits for a row's items ends the wait", async () => {
    await open_untouched("page", "is_late_key");
    await poll_until("the load to complete", async () => (await in_active_tab("document.readyState")) === "complete");
    await poll_until("the page to hold the focus", async () => (await in_active_tab("document.hasFocus()")) === true);
    await sleep(1000);
    await press_keys("-k", "Escape");
    await sleep(300);
    await draw_late_items();
    await sleep(ROW_ITEMS_WAIT_MS);
    expect((await badge()) === "NORMAL", `the badge is ${await badge()}`);
  });

  await run_case("a page with no list stays in normal mode", async () => {
    await open_page("page", "is_none", { new_tab: true });
    await sleep(2500);
    expect((await badge()) === "NORMAL", `the badge is ${await badge()}`);
  });

  await run_case("a site row that sets item_navigator to false keeps the page in normal mode", async () => {
    await open_page("item_list", "is_off", { new_tab: true });
    await sleep(2500);
    expect((await badge()) === "NORMAL", `the badge is ${await badge()}`);
    await press_keys("I");
    await expect_badge("ITEM");
  });

  await run_case("a page with a list and a frame starts in item mode in the frame too", async () => {
    await open_untouched("item_list", "is_frame_frame");
    await expect_started("is_frame_frame");
    await in_active_tab(`document.getElementById("inner").contentWindow.focus(); 0`);
    await expect_badge("ITEM");
    await press_keys("j");
    await poll_until("focus on f0 in the frame", async () => (await in_active_tab(`document.getElementById("inner").contentDocument.activeElement?.id ?? ""`)) === "f0");
  });
}
