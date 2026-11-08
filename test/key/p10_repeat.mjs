// Key test cases of `.` (repeat). run.mjs calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["keys"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, poll_until, settle_focus, settle_tab_switch, barrier, hint_label_count, open_page, wait_event, find_event, events, expect, wait_active_tab, tab_switch_mark, tabs_shown_since }) {
  const tab_count = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).length)()`);
  const close_tabs_with = (text) => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const wait_for_labels = (what) => poll_until(`the hint labels after ${what}`, async () => (await hint_label_count()) > 0);

  await run_case("gt then . moves one tab further", async () => {
    await open_page("page", "rp_one", { new_tab: true });
    await open_page("page", "rp_two", { new_tab: true });
    await open_page("page", "rp_three", { new_tab: true });
    for (const expected of ["rp_two", "rp_one"]) {
      await press_keys("gT");
      await wait_active_tab(expected, `${expected} after gT`);
      await settle_tab_switch();
    }
    await press_keys("gt");
    await wait_active_tab("rp_two", "rp_two after gt");
    await settle_tab_switch();
    await press_keys(".");
    await wait_active_tab("rp_three", "rp_three after .");
    await close_tabs_with("rp_");
  });

  await run_case("a hint pick then . shows hints again for the same kind of pick", async () => {
    await open_page("hints", "rp_hints", { new_tab: true });
    const tabs_before = await tab_count();
    const first_mark = events.length;
    await press_keys("F");
    await wait_for_labels("F");
    await press_keys("s");
    await wait_event(first_mark, loaded("hint_two"), "the first background tab");
    await close_tabs_with("hint_two");
    await poll_until("the background tab to close", async () => (await tab_count()) === tabs_before);
    const mark = events.length;
    const switch_mark = await tab_switch_mark();
    await press_keys(".");
    await wait_for_labels(".");
    await press_keys("s");
    await wait_event(mark, loaded("hint_two"), "the link to load in a new tab after . and a label");
    await poll_until(". then a label to open one background tab", async () => (await tab_count()) === tabs_before + 1);
    // The barrier reaches this page only when it is still the front tab.
    await barrier("rp_hints");
    expect((await tabs_shown_since(switch_mark)).length === 0, `a background tab came to the front: ${(await tabs_shown_since(switch_mark)).join(", ")}`);
    await close_tabs_with("hint_two");
    await close_tabs_with("rp_hints");
  });

  // The pick navigates this tab, which can end the content script before it re-records anything, so the router must not store the open.
  await run_case("an f pick that leaves the page then . shows hints again, and does not reopen the address", async () => {
    await open_page("hints", "rp_here", { new_tab: true });
    let mark = events.length;
    await press_keys("f");
    await wait_for_labels("f");
    await press_keys("a");
    await wait_event(mark, loaded("hint_one"), "this tab to load the first link");
    await evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.goBack(tab.id); })()`);
    await poll_until("the tab to be back on rp_here", async () => (await evaluate_in_background(rdp, extension_id, `browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.url.includes("id=rp_here") && tab.status === "complete")`)) === true, { timeout_ms: 8000 });
    await settle_focus();
    mark = events.length;
    await press_keys(".");
    await wait_for_labels(".");
    await press_keys("s");
    await wait_event(mark, loaded("hint_two"), "the second link to load after . and a label");
    expect(!find_event(mark, loaded("hint_one")), ". reopened the address instead of showing hints");
    await close_tabs_with("hint_two");
    await close_tabs_with("rp_here");
  });
}
