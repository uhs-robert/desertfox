// Key test cases of piece P5 (hints). run.mjs calls run_cases with its helpers.
// The fixture page /hints holds a hidden link and a covered link before two plain ones, so the labels "a" and "s" belong to the plain links only when the visibility rules work.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["hints"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, press_keys, poll_until, barrier, expect_absent, hint_label_count, scroll_report_wait_ms, open_page, wait_event, find_event, events, expect, sleep, scroll_delta_by_press, scroll_of, take_shot, tab_switch_mark, expect_no_tab_shown }) {
  const tab_count = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).length)()`);
  const close_tabs_with = (text) => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const press_hint_start = async (key) => {
    await press_keys(key);
    await poll_until(`the hint labels after ${key}`, async () => (await hint_label_count()) > 0);
  };

  await run_case("f then a label opens that link in this tab", async () => {
    await open_page("hints", "h_here", { new_tab: true });
    const mark = events.length;
    await press_hint_start("f");
    await press_keys("a");
    await wait_event(mark, loaded("hint_one"), "the first visible link to load after f a");
    expect(!find_event(mark, loaded("hint_covered")) && !find_event(mark, loaded("hint_hidden")), "a hidden or covered link got a label");
  });

  await run_case("F then a label opens that link in a background tab", async () => {
    await open_page("hints", "h_background", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    const switch_mark = await tab_switch_mark();
    await press_hint_start("F");
    await press_keys("s");
    await wait_event(mark, loaded("hint_two"), "the second link to load in a new tab");
    await poll_until("exactly one more tab", async () => (await tab_count()) === tabs_before + 1);
    // The barrier reaches this page only when it is still the front tab.
    await barrier("h_background");
    await expect_no_tab_shown(switch_mark, "a background tab came to the front");
    await close_tabs_with("hint_two");
  });

  await run_case("Escape cancels: the labels take letters while shown, and nothing opens after Escape", async () => {
    await open_page("hints", "h_cancel", { new_tab: true });
    const mark = events.length;
    await press_hint_start("f");
    // j is a hint letter with no label here, so it is taken and the page does not scroll.
    await press_keys("j");
    await press_keys("-k", "Escape");
    await poll_until("the labels to go after Escape", async () => (await hint_label_count()) === 0);
    await press_keys("a");
    await expect_absent(mark, "h_cancel", (event) => event.type === "scroll" || loaded("hint_one")(event), "j scrolled while hints were shown, or a opened a link after Escape", { report_delay_ms: scroll_report_wait_ms });
    expect((await scroll_delta_by_press("h_cancel", ["j"])) > 0, "keys did not work again after Escape");
  });

  // Set DESERTFOX_SHOT_DIR to also save a screenshot of the labels.
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  if (shot_dir) {
    await run_case("screenshot of the hint labels", async () => {
      await open_page("hints", "h_shot", { new_tab: true });
      await send_keys("f");
      await sleep(600);
      await take_shot(`${shot_dir}/hints.png`);
      await send_keys("-k", "Escape");
    });
  }
}
