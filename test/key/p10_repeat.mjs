// Key test cases of `.` (repeat). run.mjs calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["keys", "scroll", "bundles"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, poll_until, settle_focus, barrier, in_background, hint_label_count, open_page, wait_event, find_event, events, expect, wait_active_tab, tab_switch_mark, expect_no_tab_shown }) {
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
      await settle_focus();
    }
    await press_keys("gt");
    await wait_active_tab("rp_two", "rp_two after gt");
    await settle_focus();
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
    await expect_no_tab_shown(switch_mark, "a background tab came to the front");
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

  // A page command is recorded by the content script when its leaf ends, and the `.` that follows must find it.
  await run_case("C-d then . scrolls another half page", async () => {
    await open_page("aligned", "rp_scroll", { new_tab: true });
    const scroll_y = async () => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "Math.round(scrollY)" }))`))[0];
    const half = (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "Math.round(innerHeight / 2)" }))`))[0];
    await press_keys("-M", "ctrl", "d", "-m", "ctrl");
    await poll_until("the first half page", async () => (await scroll_y()) >= half - 1);
    await press_keys(".");
    await poll_until("the second half page after .", async () => (await scroll_y()) >= 2 * half - 2);
    await close_tabs_with("rp_scroll");
  });

  // page.stop sits in the lazy page bundle: the first xp loads it, and the replay by . runs the registered handler. The stub sits on the content script's window, which executeScript shares.
  await run_case("xp then . stops the page twice through the page bundle", async () => {
    await open_page("aligned", "rp_stop", { new_tab: true });
    const in_page = async (code) => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))`))[0];
    await in_page(`window.__stops = 0; window.stop = () => { window.__stops++; }; 0`);
    await press_keys("xp");
    await poll_until("the first xp to stop the page", async () => (await in_page(`window.__stops`)) === 1);
    await press_keys(".");
    await poll_until("the . to stop the page again", async () => (await in_page(`window.__stops`)) === 2);
    await close_tabs_with("rp_stop");
  });
  const in_active_page = async (code) => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))`))[0];
  const field_value = () => in_active_page(`document.getElementById("paste_target").value`);

  // The text recorder lives in the lazy text bundle. gi is the entry, so the replay focuses the field again, and a count types the text that many times.
  await run_case("gi, typed text and Escape, then . and 3. type the text again into the field", async () => {
    await open_page("caret", "rp_text", { new_tab: true });
    await press_keys("gi");
    await poll_until("gi to focus the field", async () => (await in_active_page(`document.activeElement.id`)) === "paste_target");
    await press_keys("ab");
    await poll_until("the field to hold ab", async () => (await field_value()) === "ab");
    await press_keys("-k", "Escape");
    await poll_until("Escape to leave the field", async () => (await in_active_page(`document.activeElement.id`)) !== "paste_target");
    await in_active_page(`document.getElementById("paste_target").value = ""; 0`);
    await press_keys(".");
    await poll_until("the replay to type ab", async () => (await field_value()) === "ab");
    await press_keys("-k", "Escape");
    await in_active_page(`document.getElementById("paste_target").value = ""; 0`);
    await press_keys("3.");
    await poll_until("3. to type ab three times, and not nine", async () => (await field_value()) === "ababab");
    await close_tabs_with("rp_text");
  });

  // A password field is never recorded, so . keeps the earlier command.
  await run_case("text typed into a password field is not what . repeats", async () => {
    await open_page("caret", "rp_secret", { new_tab: true });
    await in_active_page(`document.getElementById("paste_target").type = "password"; 0`);
    await press_keys("gi");
    await poll_until("gi to focus the field", async () => (await in_active_page(`document.activeElement.id`)) === "paste_target");
    await press_keys("hunter2");
    await poll_until("the field to hold the password", async () => (await field_value()) === "hunter2");
    await press_keys("-k", "Escape");
    const stored = await in_background(`browser.storage.session.get().then((all) => JSON.stringify(all))`);
    expect(!stored.includes("hunter2"), "the password reached storage.session");
    await close_tabs_with("rp_secret");
  });

  // A command typed from the field never blurs it. The text must be stored before the command, so . repeats the command.
  await run_case("a tab key typed from the field comes after the text, so . repeats the key", async () => {
    await open_page("page", "rp_order_a", { new_tab: true });
    await open_page("caret", "rp_order_b", { new_tab: true });
    await press_keys("gi");
    await poll_until("gi to focus the field", async () => (await in_active_page(`document.activeElement.id`)) === "paste_target");
    await press_keys("xy");
    await poll_until("the field to hold xy", async () => (await field_value()) === "xy");
    await press_keys("-M", "alt", "k", "-m", "alt");
    await wait_active_tab("rp_order_a", "rp_order_a after A-k");
    await settle_focus();
    await press_keys(".");
    await wait_active_tab((page_id) => page_id !== "rp_order_a", "the tab key repeated off rp_order_a");
    await close_tabs_with("rp_order");
  });
}
