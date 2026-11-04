// Key test cases of `.` (repeat). run.mjs calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, became_visible }) {
  const tab_count = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).length)()`);
  const close_tabs_with = (text) => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;

  await run_case("gt then . moves one tab further", async () => {
    await open_page("page", "rp_one", { new_tab: true });
    await open_page("page", "rp_two", { new_tab: true });
    await open_page("page", "rp_three", { new_tab: true });
    await send_keys("gT");
    await sleep(500);
    await send_keys("gT");
    await sleep(500);
    let mark = events.length;
    await send_keys("gt");
    await wait_event(mark, became_visible("rp_two"), "rp_two after gt");
    mark = events.length;
    await send_keys(".");
    await wait_event(mark, became_visible("rp_three"), "rp_three after .");
    await close_tabs_with("rp_");
    await sleep(300);
  });

  await run_case("a hint pick then . shows hints again for the same kind of pick", async () => {
    await open_page("hints", "rp_hints", { new_tab: true });
    const first_mark = events.length;
    await send_keys("F");
    await send_keys("s");
    await wait_event(first_mark, loaded("hint_two"), "the first background tab");
    await sleep(500);
    await close_tabs_with("hint_two");
    await sleep(500);
    const tabs_before = await tab_count();
    const mark = events.length;
    await send_keys(".");
    await sleep(700);
    await send_keys("s");
    await wait_event(mark, loaded("hint_two"), "the link to load in a new tab after . and a label");
    await sleep(500);
    expect((await tab_count()) === tabs_before + 1, ". then a label did not open one background tab");
    expect(!find_event(mark, became_visible("hint_two")), "the background tab came to the front");
    await close_tabs_with("hint_two");
    await close_tabs_with("rp_hints");
    await sleep(300);
  });
}
