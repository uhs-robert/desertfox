// The item_navigator setting means that list pages start in item mode: when a page with a list has loaded, the badge says ITEM with no key pressed. A page with no list stays in normal mode, Escape leaves item mode for good on that page, and a site row that sets the setting to false keeps its page in normal mode.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles"];

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load a config with item_navigator on and a row that turns it off for the is_off pages", async () => {
    const dir = config_copy();
    const file = join(dir, "settings.toml");
    // A top-level setting goes above the first table.
    writeFileSync(file, `item_navigator = true\n${readFileSync(file, "utf8")}`);
    appendFileSync(file, '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=is_off*"\nitem_navigator = false\n');
    await load_config_dir(dir);
  });

  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const expect_badge = (label) => poll_until(`the ${label} badge`, async () => (await badge()) === label, { timeout_ms: 5000 });
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");

  await run_case("a page with a list starts in item mode, and j walks it with no I", async () => {
    await open_page("item_list", "is_list", { new_tab: true });
    await expect_badge("ITEM");
    await press_keys("j");
    await poll_until("focus on c0", async () => (await focused()) === "c0");
  });

  await run_case("Escape leaves item mode and the page does not start it again", async () => {
    await open_page("item_list", "is_escape", { new_tab: true });
    await expect_badge("ITEM");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    // The start waits for an idle moment and checks once, so a second one would come within this time.
    await sleep(2500);
    expect((await badge()) === "NORMAL", `item mode came back, the badge is ${await badge()}`);
    await press_keys("I");
    await expect_badge("ITEM");
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
    await open_page("item_list", "is_frame_frame", { new_tab: true });
    await expect_badge("ITEM");
    await in_active_tab(`document.getElementById("inner").contentWindow.focus(); 0`);
    await expect_badge("ITEM");
    await press_keys("j");
    await poll_until("focus on f0 in the frame", async () => (await in_active_tab(`document.getElementById("inner").contentDocument.activeElement?.id ?? ""`)) === "f0");
  });
}
