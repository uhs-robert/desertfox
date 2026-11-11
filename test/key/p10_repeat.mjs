// Key test cases of `.` (repeat). run.mjs calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";
import { SHIFT_ESCAPE } from "./harness.mjs";

export const areas = ["keys", "scroll", "bundles"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, poll_until, settle_focus, barrier, in_background, hint_label_count, badge_is, open_page, wait_event, find_event, events, expect, wait_active_tab, tab_switch_mark, expect_no_tab_shown }) {
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

  // page.stop stays in content.js, so it works on a page stuck loading, where a bundle injection can go unanswered. The stub sits on the content script's window, which executeScript shares.
  await run_case("xp then . stops the page twice from the content script", async () => {
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
  const focused_id = () => in_active_page(`document.activeElement.id`);
  const clear_field = () => in_active_page(`document.getElementById("paste_target").value = ""; 0`);
  const wait_for_field_focus = () => poll_until("the field to take focus", async () => (await focused_id()) === "paste_target");
  const escape_from_field = async (what) => {
    await press_keys("-k", "Escape");
    await poll_until(`Escape to leave the field (${what})`, async () => (await focused_id()) !== "paste_target");
  };
  const toast_on = (page_id) => (event) => event.type === "toast" && event.page_id === page_id;

  // The text recorder lives in the lazy text bundle. gi is the entry, so the replay focuses the field again, and a count types the text that many times.
  await run_case("gi, typed text and Escape, then . and 3. type the text again into the field", async () => {
    await open_page("caret", "rp_text", { new_tab: true });
    await press_keys("gi");
    await wait_for_field_focus();
    await press_keys("ab");
    await poll_until("the field to hold ab", async () => (await field_value()) === "ab");
    await escape_from_field("first");
    await clear_field();
    await press_keys(".");
    await poll_until("the replay to type ab", async () => (await field_value()) === "ab");
    await escape_from_field("replay");
    await clear_field();
    await press_keys("3.");
    await poll_until("3. to type ab three times, and not nine", async () => (await field_value()) === "ababab");
    await close_tabs_with("rp_text");
  });

  // The first text in a page loads the text bundle, and the `.` pressed right after Escape must wait until that text is recorded.
  await run_case("Escape then . with no step between types the text again", async () => {
    await open_page("caret", "rp_quick", { new_tab: true });
    await press_keys("gi");
    await wait_for_field_focus();
    await press_keys("ab");
    await poll_until("the field to hold ab", async () => (await field_value()) === "ab");
    await press_keys("-k", "Escape", ".");
    await poll_until("the replay to make abab", async () => (await field_value()) === "abab");
    await close_tabs_with("rp_quick");
  });

  // The recorder compares the field before and after, so an edit that is not a typed character still lands as the field shows it.
  await run_case("a word deleted with Ctrl+Backspace is not in the text that . types", async () => {
    await open_page("caret", "rp_word", { new_tab: true });
    await press_keys("gi");
    await wait_for_field_focus();
    await press_keys("keep drop");
    await poll_until("the field to hold the typed text", async () => (await field_value()) === "keep drop");
    await press_keys("-M", "ctrl", "-k", "BackSpace", "-m", "ctrl");
    await poll_until("the word to go", async () => (await field_value()) === "keep ");
    await escape_from_field("word");
    await clear_field();
    await press_keys(".");
    await poll_until("the replay to type the text without the deleted word", async () => (await field_value()) === "keep ");
    await close_tabs_with("rp_word");
  });

  // A field focused by script has no entry command, so the replay types into the field the last Escape left. A contenteditable takes the text the same way.
  await run_case("text typed in a contenteditable is typed again by . into the field Escape left", async () => {
    await open_page("caret", "rp_editable", { new_tab: true });
    await in_active_page(`document.body.insertAdjacentHTML("beforeend", '<div id="rp_ce" contenteditable="true"></div>'); document.getElementById("rp_ce").focus(); 0`);
    await poll_until("the contenteditable to take focus", async () => (await focused_id()) === "rp_ce");
    await press_keys("hi");
    await poll_until("the contenteditable to hold hi", async () => (await in_active_page(`document.getElementById("rp_ce").innerText`)) === "hi");
    await press_keys("-k", "Escape");
    await poll_until("Escape to leave the contenteditable", async () => (await focused_id()) !== "rp_ce");
    await in_active_page(`document.getElementById("rp_ce").innerText = ""; 0`);
    await press_keys(".");
    await poll_until("the replay to type hi", async () => (await in_active_page(`document.getElementById("rp_ce").innerText`)) === "hi");
    await close_tabs_with("rp_editable");
  });

  // A script blur leaves no field for the replay, so the refusal is the whole answer.
  await run_case(". with no field to type into refuses with a notice and types nothing", async () => {
    await open_page("caret", "rp_nofield", { new_tab: true });
    await in_active_page(`document.getElementById("paste_target").focus(); 0`);
    await wait_for_field_focus();
    await press_keys("ab");
    await poll_until("the field to hold ab", async () => (await field_value()) === "ab");
    await in_active_page(`document.getElementById("paste_target").blur(); document.getElementById("paste_target").value = ""; 0`);
    await poll_until("the blur to leave the field", async () => (await focused_id()) !== "paste_target");
    await settle_focus();
    const mark = events.length;
    await press_keys(".");
    await wait_event(mark, toast_on("rp_nofield"), "the refusal notice");
    expect((await field_value()) === "", "the replay typed into a field it should not have found");
    await close_tabs_with("rp_nofield");
  });

  // A password field is never recorded, so . keeps the earlier command.
  await run_case("text typed into a password field is not what . repeats", async () => {
    await open_page("caret", "rp_secret", { new_tab: true });
    await in_active_page(`document.getElementById("paste_target").type = "password"; 0`);
    await press_keys("gi");
    await wait_for_field_focus();
    await press_keys("hunter2");
    await poll_until("the field to hold the password", async () => (await field_value()) === "hunter2");
    await escape_from_field("password");
    await barrier("rp_secret");
    const stored = await in_background(`browser.storage.session.get().then((all) => JSON.stringify(all))`);
    expect(!stored.includes("hunter2"), "the password reached storage.session");
    await close_tabs_with("rp_secret");
  });

  // Ignore mode passes every key to the page, so DesertFox records nothing there.
  await run_case("text typed in ignore mode is not recorded", async () => {
    await open_page("caret", "rp_ignore", { new_tab: true });
    const mark = events.length;
    await press_keys(...SHIFT_ESCAPE);
    await wait_event(mark, badge_is("rp_ignore", "IGNORE"), "the IGNORE badge");
    await in_active_page(`document.getElementById("paste_target").focus(); 0`);
    await wait_for_field_focus();
    await press_keys("zebra");
    await poll_until("the field to hold zebra", async () => (await field_value()) === "zebra");
    await in_active_page(`document.getElementById("paste_target").blur(); 0`);
    await barrier("rp_ignore");
    const stored = await in_background(`browser.storage.session.get().then((all) => JSON.stringify(all))`);
    expect(!stored.includes("zebra"), "ignore mode typing reached storage.session");
    await close_tabs_with("rp_ignore");
  });

  // A command typed from the field never blurs it. The text must be stored before the command, so . repeats the command.
  await run_case("a tab key typed from the field comes after the text, so . repeats the key", async () => {
    await open_page("page", "rp_order_a", { new_tab: true });
    await open_page("caret", "rp_order_b", { new_tab: true });
    await press_keys("gi");
    await wait_for_field_focus();
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
