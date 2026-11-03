// Key test cases of piece P5 (hints). run.mjs calls this with its helpers.
// The fixture page /hints holds a hidden link and a covered link before two plain ones, so the labels "a" and "s" belong to the plain links only when the visibility rules work.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_hint_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, scroll_delta_after, became_visible }) {
  const tab_count = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).length)()`);
  const close_tabs_with = (text) => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;

  await run_case("f then a label opens that link in this tab", async () => {
    await open_page("hints", "h_here", { new_tab: true });
    const mark = events.length;
    await send_keys("f");
    await send_keys("a");
    await wait_event(mark, loaded("hint_one"), "the first visible link to load after f a");
    expect(!find_event(mark, loaded("hint_covered")) && !find_event(mark, loaded("hint_hidden")), "a hidden or covered link got a label");
  });

  await run_case("F then a label opens that link in a background tab", async () => {
    await open_page("hints", "h_background", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await send_keys("F");
    await send_keys("s");
    await wait_event(mark, loaded("hint_two"), "the second link to load in a new tab");
    await sleep(500);
    expect((await tab_count()) === tabs_before + 1, "F did not add exactly one tab");
    expect(!find_event(mark, became_visible("hint_two")), "the background tab came to the front");
    await close_tabs_with("hint_two");
    await sleep(300);
  });

  await run_case("Escape cancels: the labels take letters while shown, and nothing opens after Escape", async () => {
    await open_page("hints", "h_cancel", { new_tab: true });
    const mark = events.length;
    await send_keys("f");
    // j is a hint letter with no label here, so it is taken and the page does not scroll.
    await send_keys("j");
    await sleep(500);
    expect(!find_event(mark, (event) => event.type === "scroll"), "j scrolled while hints were shown");
    await send_keys("-k", "Escape");
    await send_keys("a");
    await sleep(800);
    expect(!find_event(mark, loaded("hint_one")), "a opened a link after Escape");
    expect((await scroll_delta_after("h_cancel", ["j"])) > 0, "keys did not work again after Escape");
  });
}
