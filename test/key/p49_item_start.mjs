// The item_navigator setting means that list pages start in item mode: when a page with a list has loaded, the badge says ITEM with no key pressed. A page with no list stays in normal mode, Escape leaves item mode for good on that page, a key pressed before the load completes keeps the page in normal mode, and a site row that sets the setting to false keeps its page in normal mode. With the setting at its default, a link to the same host followed in item mode (Enter, also while the page loads, and ]]) opens a list page in item mode, from its first keymap read, so a key pressed during its load runs in item mode. Escape during that load leaves the mode for good, and a page with no list drops to normal mode when its load completes. A reload, Back, a link to another host and :open do not.
// A page that should start opens without the key probe, since any key pressed before the start wins over it. The probe runs once the badge says ITEM.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROW_ITEMS_WAIT_MS } from "../../src/content/item/start.ts";

export const areas = ["keys", "config", "bundles"];

const IS_OFF_ROW = '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=is_off*"\nitem_navigator = false\n';

export async function run_cases({ config_copy, load_config_dir, setup, run_case, on_teardown, open_page, press_keys, run_line, in_active_tab, poll_until, expect, sleep, in_background, events, wait_event, url_of, settle_focus }) {
  await setup("load a config with item_navigator on and a row that turns it off for the is_off pages", async () => {
    const dir = config_copy();
    const file = join(dir, "settings.toml");
    // A top-level setting goes above the first table.
    writeFileSync(file, `item_navigator = true\n${readFileSync(file, "utf8")}`);
    appendFileSync(file, IS_OFF_ROW);
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

  await setup("load the config with item_navigator at its default, which starts no test page", async () => {
    // The reload key is a normal mode key, and the last page may sit in item mode.
    await open_page("page", "is_sticky_setup", { new_tab: true });
    // The row that turns item mode off for the is_off pages stays, so a link followed in the mode can land on one.
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), IS_OFF_ROW);
    await load_config_dir(dir);
  });

  await run_case("Enter on an item whose link opens a list page in the same tab lands in item mode, and a reload or Back does not", async () => {
    await open_page("item_list", "is_sticky_from", { new_tab: true });
    // An unload listener keeps the page out of the back-forward cache, so Back below loads it again.
    await in_active_tab(`document.querySelectorAll(".card a").forEach((link) => (link.href = ${JSON.stringify(url_of("item_list", "is_sticky_to"))})); addEventListener("unload", () => {}); 0`);
    await press_keys("I");
    await expect_badge("ITEM");
    const mark = events.length;
    await press_keys("j", "-k", "Return");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "is_sticky_to", "content script ready on is_sticky_to", 6000);
    await expect_started("is_sticky_to");
    await press_keys("j");
    await poll_until("focus on c0", async () => (await focused()) === "c0");
    const reload_mark = events.length;
    await in_active_tab("location.reload(); 0");
    await wait_event(reload_mark, (event) => event.type === "tree_read" && event.page_id === "is_sticky_to", "content script ready after the reload", 6000);
    await sleep(2500);
    expect((await badge()) === "NORMAL", `the reload kept item mode, the badge is ${await badge()}`);
    await press_keys("I");
    await expect_badge("ITEM");
    const back_mark = events.length;
    await in_active_tab("history.back(); 0");
    await wait_event(back_mark, (event) => event.type === "tree_read" && event.page_id === "is_sticky_from", "content script ready after Back", 6000);
    await sleep(2500);
    expect((await badge()) === "NORMAL", `Back kept item mode, the badge is ${await badge()}`);
  });

  // Opens a list page in normal mode, points every card link at `to`, and starts item mode with I.
  const list_in_item_mode = async (id, to) => {
    await open_page("item_list", id, { new_tab: true });
    await in_active_tab(`document.querySelectorAll(".card a").forEach((link) => (link.href = ${JSON.stringify(to)})); 0`);
    await press_keys("I");
    await expect_badge("ITEM");
  };
  const expect_normal_on = async (id, mark) => {
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 6000);
    await sleep(2500);
    expect((await badge()) === "NORMAL", `item mode carried onto ${id}, the badge is ${await badge()}`);
  };

  await run_case("Enter on an item while the page still loads lands in item mode", async () => {
    // A `_slow` id holds the load open for 2.5 s, so the old load ends as aborted while the new one starts.
    await list_in_item_mode("is_sticky_from_slow", url_of("item_list", "is_sticky_slow_to"));
    expect((await in_active_tab("document.readyState")) !== "complete", "the page completed before Enter, so the case tests nothing");
    const mark = events.length;
    await press_keys("j", "-k", "Return");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "is_sticky_slow_to", "content script ready on is_sticky_slow_to", 6000);
    await expect_started("is_sticky_slow_to");
  });

  await run_case("]] in item mode to a next page with a list lands in item mode", async () => {
    await list_in_item_mode("is_sticky_series", url_of("item_list", "is_sticky_series_2"));
    await in_active_tab(`document.body.insertAdjacentHTML("beforeend", '<a rel="next" href=${JSON.stringify(url_of("item_list", "is_sticky_series_2"))}>Next</a>'); 0`);
    const mark = events.length;
    await press_keys("]", "]");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "is_sticky_series_2", "content script ready on is_sticky_series_2", 6000);
    await expect_started("is_sticky_series_2");
  });

  // ]] from a list page in item mode to `to`, which loads slowly. Returns once `to_id` takes keys, with the load still open.
  const jump_to_slow_page = async (from_id, to, to_id) => {
    await list_in_item_mode(from_id, to);
    await in_active_tab(`document.body.insertAdjacentHTML("beforeend", '<a rel="next" href=${JSON.stringify(to)}>Next</a>'); 0`);
    const mark = events.length;
    await press_keys("]", "]");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === to_id, `content script ready on ${to_id}`, 6000);
    // Firefox drops a key pressed in about the first 120 ms of a page. The probe key counts as a press, which a carried mode outlives.
    await settle_focus({ keys_page_id: to_id });
    expect((await in_active_tab("document.readyState")) !== "complete", "the load completed before the page took keys, so the case tests nothing");
  };
  const expect_item_while_loading = async () => {
    await expect_badge("ITEM");
    expect((await in_active_tab("document.readyState")) !== "complete", "item mode came only when the load completed");
  };

  // Logs, from the background, when the top frame commits and when its keymap read arrives. The join needs the commit first, and a read that comes first leaves the start to the completed load. The listener answers nothing.
  const watch_commit_and_read = async () => {
    await in_background(`(() => {
      const order = (globalThis.p49_order = []);
      globalThis.p49_commit = ({ frameId, url }) => void (frameId === 0 && order.push(["commit", url, performance.now()]));
      globalThis.p49_read = (message, sender) => void (message?.type === "read_keymap" && sender.frameId === 0 && order.push(["read_keymap", sender.url, performance.now()]));
      browser.webNavigation.onCommitted.addListener(globalThis.p49_commit);
      browser.runtime.onMessage.addListener(globalThis.p49_read);
      return 0;
    })()`);
    on_teardown(() => in_background(`(browser.webNavigation.onCommitted.removeListener(globalThis.p49_commit), browser.runtime.onMessage.removeListener(globalThis.p49_read), 0)`));
    return async (to) => {
      const on_page = (await in_background("globalThis.p49_order")).filter(([, url]) => url === to);
      console.log(`p49 event order on the next page: ${on_page.map(([kind, , ms]) => `${kind} ${(ms - on_page[0][2]).toFixed(1)} ms`).join(", ")}`);
    };
  };

  await run_case("j pressed while a next page from ]] in item mode loads runs in item mode, and the page stays in it", async () => {
    const to = url_of("item_list", "is_sticky_jump_slow");
    const log_order = await watch_commit_and_read();
    await jump_to_slow_page("is_sticky_jump", to, "is_sticky_jump_slow");
    await press_keys("j");
    await expect_item_while_loading();
    await poll_until("focus on c0", async () => (await focused()) === "c0");
    expect((await in_active_tab("document.readyState")) !== "complete", "the load completed before j, so the case tests nothing");
    await log_order(to);
    await poll_until("the load to complete", async () => (await in_active_tab("document.readyState")) === "complete", { timeout_ms: 5000 });
    await sleep(1500);
    expect((await badge()) === "ITEM", `the key cancelled the carried mode, the badge is ${await badge()}`);
    await press_keys("j");
    await poll_until("focus on c1", async () => (await focused()) === "c1");
  });

  await run_case("a next page from ]] in item mode with a frame takes item mode in the frame too while it loads", async () => {
    await jump_to_slow_page("is_sticky_framed", url_of("item_list", "is_sticky_framed_slow_frame"), "is_sticky_framed_slow_frame");
    await expect_item_while_loading();
    await in_active_tab(`document.getElementById("inner").contentWindow.focus(); 0`);
    await press_keys("j");
    await poll_until("focus on f0 in the frame", async () => (await in_active_tab(`document.getElementById("inner").contentDocument.activeElement?.id ?? ""`)) === "f0");
  });

  await run_case("Escape pressed while a next page from ]] in item mode loads leaves item mode for good", async () => {
    await jump_to_slow_page("is_sticky_esc", url_of("item_list", "is_sticky_esc_slow"), "is_sticky_esc_slow");
    await expect_item_while_loading();
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    expect((await in_active_tab("document.readyState")) !== "complete", "the load completed before Escape, so the case tests nothing");
    await poll_until("the load to complete", async () => (await in_active_tab("document.readyState")) === "complete", { timeout_ms: 5000 });
    await sleep(2500);
    expect((await badge()) === "NORMAL", `item mode came back after Escape, the badge is ${await badge()}`);
  });

  await run_case("a next page from ]] in item mode with no list drops to normal mode when its load completes", async () => {
    // A page with no list whose image holds the load open for 2.5 s. It also changes its own address while it loads, which keeps the mode.
    const to = url_of("replaces_address", "is_sticky_none");
    await jump_to_slow_page("is_sticky_none_from", to, "is_sticky_none");
    await expect_item_while_loading();
    await poll_until("the load to complete", async () => (await in_active_tab("document.readyState")) === "complete", { timeout_ms: 5000 });
    await expect_badge("NORMAL");
  });

  await run_case("a next page from ]] in item mode whose site row sets item_navigator to false stays in normal mode while it loads", async () => {
    await jump_to_slow_page("is_sticky_refused", url_of("item_list", "is_off_sticky_slow"), "is_off_sticky_slow");
    await poll_until("the badge to show", async () => (await badge()) !== null);
    expect((await badge()) === "NORMAL", `the page joined item mode during its load, the badge is ${await badge()}`);
    await poll_until("the load to complete", async () => (await in_active_tab("document.readyState")) === "complete", { timeout_ms: 5000 });
    await sleep(1500);
    expect((await badge()) === "NORMAL", `the badge is ${await badge()}`);
  });

  await run_case("Enter on an item that links to another host ends item mode", async () => {
    await list_in_item_mode("is_sticky_cross", url_of("item_list", "is_sticky_far").replace("127.0.0.1", "localhost"));
    const mark = events.length;
    await press_keys("j", "-k", "Return");
    await expect_normal_on("is_sticky_far", mark);
  });

  await run_case(":open in item mode ends item mode on the opened page", async () => {
    await list_in_item_mode("is_sticky_open", url_of("item_list", "is_sticky_open_to"));
    const mark = events.length;
    await run_line(`open ${url_of("item_list", "is_sticky_open_to")}`);
    await expect_normal_on("is_sticky_open_to", mark);
  });
}
