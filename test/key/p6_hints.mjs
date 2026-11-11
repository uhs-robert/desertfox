// Key cases of piece P6 (hint extras): copy, rapid mode, the text filter and the `sh` headings list. run.mjs calls run_cases with its helpers.
// The fixture page /hints has a hidden link and a covered link before the visible links "one" and "two", labelled "a" and "s".
// There is no key for the text filter yet, so its cases send the same `run` message a key sends, from the active tab.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["hints", "scroll"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, press_keys, poll_until, barrier, expect_absent, hint_label_count, wait_cmdline, close_cmdline, scroll_report_wait_ms, open_page, wait_event, find_event, events, expect, sleep, scroll_delta_by_press, take_shot, in_active_tab, type_in_line, tab_switch_mark, expect_no_tab_shown }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const tab_count = () => background(`(async () => (await browser.tabs.query({})).length)()`);
  const close_tabs_with = (text) => background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];
  const wait_for_labels = (what) => poll_until(`the hint labels after ${what}`, async () => (await hint_label_count()) > 0);
  const wait_for_label_count = (count, what) => poll_until(`${count} hint labels ${what}`, async () => (await hint_label_count()) === count);
  const wait_for_tab_count = (count, what) => poll_until(what, async () => (await tab_count()) === count);

  const run_hint = (args) => in_active_tab(`browser.runtime.sendMessage({ type: "run", invocations: [{ id: "hint.run", args: ${JSON.stringify(args)} }], mode: "normal" }); 0`);
  const link_count = async () => await in_active_tab(`document.querySelectorAll("a[href]").length`);
  const wait_for_link_count = (count, what) => poll_until(what, async () => (await link_count()) === count);
  const notice_text = () => in_active_tab(`[...document.documentElement.children].map((child) => child.openOrClosedShadowRoot?.querySelector(".desertfox-toast, .desertfox-hint-message")?.textContent ?? "").join("")`);
  // A copy has no report of its own. The labels go when the pick is handled, and opening the paste page takes longer than the copy.

  await run_case(";yl a copies the link address", async () => {
    await open_page("hints", "p6_copy", { new_tab: true });
    await press_keys(";yl");
    await wait_for_labels(";yl");
    await press_keys("a");
    await wait_for_label_count(0, "gone after the pick");
    await open_page("field", "p6_paste", { new_tab: true });
    const mark = events.length;
    await press_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_paste", "the pasted address");
    expect(pasted.value.endsWith("/page?id=hint_one"), `;yl copied "${pasted.value}"`);
  });

  // The yank keys label elements by page order. ;yt uses the all filter: the heading "a" and the paragraph "s" (the spans sit in a wrapper that the all filter drops). ;yc and ;yh use the every filter, which labels the heading, the card, its spans and the paragraph. The paste shows what the key copied.
  const yank_and_paste = async (keys, label, page_id) => {
    await open_page("prose", `${page_id}`, { new_tab: true });
    await press_keys(keys);
    await wait_for_labels(keys);
    await press_keys(label);
    await wait_for_label_count(0, "gone after the pick");
    await open_page("field", `${page_id}_paste`, { new_tab: true });
    const mark = events.length;
    await press_keys(...paste_ctrl_v);
    return (await wait_event(mark, (event) => event.type === "input" && event.page_id === `${page_id}_paste`, "the pasted text")).value;
  };

  await run_case(";yt copies the text of the picked element", async () => {
    const pasted = await yank_and_paste(";yt", "s", "p6_yank_text");
    expect(pasted === "gamma bold", `;yt copied "${pasted}"`);
  });

  await run_case(";yc copies the shortest unique selector of the picked element", async () => {
    const pasted = await yank_and_paste(";yc", "g", "p6_yank_selector");
    expect(pasted === "p", `;yc copied "${pasted}"`);
  });

  await run_case(";yh copies the whole outer HTML of the picked element", async () => {
    const pasted = await yank_and_paste(";yh", "g", "p6_yank_html");
    expect(pasted === "<p>gamma <b>bold</b></p>", `;yh copied "${pasted}"`);
  });

  await run_case(";yc skips a plain wrapper div and labels the element inside it", async () => {
    await open_page("prose", "p6_yank_wrapper", { new_tab: true });
    await in_active_tab(`document.body.innerHTML = '<div id="wrapper"><section id="leaf">leaf text</section></div>'; 0`);
    await press_keys(";yc");
    await wait_for_label_count(1, "on the leaf only");
    await press_keys("a");
    await wait_for_label_count(0, "gone after the pick");
    await open_page("field", "p6_yank_wrapper_paste", { new_tab: true });
    const mark = events.length;
    await press_keys(...paste_ctrl_v);
    const pasted = (await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_yank_wrapper_paste", "the pasted selector")).value;
    expect(pasted === "#leaf", `;yc copied "${pasted}", not the leaf`);
  });

  await run_case(";u opens the command line with the selector prompt, and a typed selector labels its matches", async () => {
    await open_page("hints", "p6_selector_prompt", { new_tab: true });
    await press_keys(";u");
    await wait_cmdline((line) => line.open && line.value === "hint --custom ", "the line to open with the prefilled prompt");
    await type_in_line("a[href]");
    await press_keys("-k", "Return");
    await wait_for_label_count(2, "on the two visible links");
  });

  await run_case(";u takes a descendant selector with a space", async () => {
    await open_page("hints", "p6_selector_descendant", { new_tab: true });
    await press_keys(";u");
    await wait_cmdline((line) => line.open && line.value === "hint --custom ", "the line to open with the prefilled prompt");
    await type_in_line("body a[href]");
    await press_keys("-k", "Return");
    await wait_for_label_count(2, "on the two visible links under body");
  });

  // The selector is a verbatim main param: the line hands it over exactly as typed, quotes included.
  for (const [what, selector, count] of [["a selector list", "a[href*=one], a[href*=two]", 2], ["an attribute selector with double quotes", `a[href="/page?id=hint_one"]`, 1]]) {
    await run_case(`;u takes ${what}`, async () => {
      await open_page("hints", "p6_selector_form", { new_tab: true });
      await press_keys(";u");
      await wait_cmdline((line) => line.open && line.value === "hint --custom ", "the line to open with the prefilled prompt");
      await type_in_line(selector);
      await press_keys("-k", "Return");
      await wait_for_label_count(count, `for ${what}`);
    });
  }

  // A key test cannot see the toolbox, and none is open here. The pick then waits, so the page shows the element on `__desertfox_pick` and the "press F12" toast.
  await run_case(";ol a leaves the picked element on the page and toasts press F12 while DevTools is closed", async () => {
    await open_page("hints", "p6_inspect", { new_tab: true });
    await press_keys(";ol");
    await wait_for_labels(";ol");
    await press_keys("a");
    await wait_for_label_count(0, "gone after the pick");
    await poll_until("the pick on the page", async () => (await in_active_tab(`window.wrappedJSObject.__desertfox_pick?.localName ?? ""`)) === "a");
    await poll_until("the press F12 toast", async () => (await notice_text()).includes("F12"));
  });

  await run_case(";yc keeps a link that wraps one child", async () => {
    await open_page("prose", "p6_yank_link_wrapper", { new_tab: true });
    await in_active_tab(`document.body.innerHTML = '<a id="card" href="#x"><span id="inner">Open</span></a>'; 0`);
    await press_keys(";yc");
    await wait_for_label_count(2, "on the link and the span inside it");
  });

  await run_case("f opens a dropdown that opens on mousedown, with one click after the mouse events", async () => {
    await open_page("chosen", "p6_chosen", { new_tab: true });
    const mark = events.length;
    await press_keys("f");
    await wait_for_labels("f");
    await press_keys("a");
    await wait_event(mark, (event) => event.type === "chosen_open" && event.page_id === "p6_chosen", "the dropdown to open on mousedown");
    await wait_event(mark, (event) => event.type === "chosen_click" && event.page_id === "p6_chosen", "the click after the mouse events");
    // A second click would arrive before the barrier key does.
    await barrier("p6_chosen");
    const order = (await in_active_tab(`window.wrappedJSObject.chosen_order.join(",")`));
    expect(order === "chosen_pointerdown,chosen_mousedown,chosen_mouseup,chosen_click", `the page saw ${order}`);
    const focused = await in_active_tab(`document.activeElement.id`);
    expect(focused === "search", `the focus is on ${focused}, not the search field the page chose`);
  });

  const outline_and_tabindex = async () => await in_active_tab(`[document.getElementById("panel").style.outline, document.getElementById("panel").getAttribute("tabindex")]`);

  await run_case(";s focuses a scroll box, then j scrolls the box and not the page", async () => {
    // The only scroll box is the side panel, so it gets the label "a". The page root is left out.
    await open_page("scrollbox", "p6_scrollbox", { new_tab: true });
    await press_keys(";s");
    await wait_for_labels(";s");
    await press_keys("a");
    await poll_until("the box to get its outline", async () => (await in_active_tab(`getComputedStyle(document.getElementById("panel")).outlineStyle`)) === "solid");
    const mark = events.length;
    await press_keys("j");
    const moved = await wait_event(mark, (event) => event.type === "panel_scroll" && event.page_id === "p6_scrollbox", "the panel to scroll after j");
    expect(moved.top > 0, `the panel is at ${moved.top} after j`);
    // The fixture reports a page scroll 150 ms after it settles.
    await expect_absent(mark, "p6_scrollbox", (event) => event.type === "scroll" && event.page_id === "p6_scrollbox", "the page scrolled with the panel", { report_delay_ms: scroll_report_wait_ms });
    await poll_until("the outline flash to end", async () => { const [outline, tabindex] = await outline_and_tabindex(); return outline === "" && tabindex === "-1"; }).catch(async (error) => { const [outline, tabindex] = await outline_and_tabindex(); throw new Error(`after the flash: inline outline "${outline}", tabindex ${tabindex} (${error.message})`); });
  });

  await run_case(";s focuses a scroll box inside a shadow root, then j scrolls that box and not the page", async () => {
    await open_page("shadowbox", "p6_shadowbox", { new_tab: true });
    await press_keys(";s");
    await wait_for_labels(";s");
    await press_keys("a");
    // The label is gone once the box has the focus.
    await wait_for_label_count(0, "gone after the pick");
    const mark = events.length;
    await press_keys("j");
    const moved = await wait_event(mark, (event) => event.type === "panel_scroll" && event.page_id === "p6_shadowbox", "the shadow panel to scroll after j");
    expect(moved.top > 0, `the shadow panel is at ${moved.top} after j`);
    await expect_absent(mark, "p6_shadowbox", (event) => event.type === "scroll" && event.page_id === "p6_shadowbox", "the page scrolled with the shadow panel", { report_delay_ms: scroll_report_wait_ms });
  });

  await run_case(";rl opens each pick in a background tab and keeps picking until Escape", async () => {
    await open_page("hints", "p6_rapid", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    const switch_mark = await tab_switch_mark();
    await press_keys(";rl");
    await wait_for_labels(";rl");
    await press_keys("a");
    await wait_event(mark, loaded("hint_one"), "the first link to load after the first pick");
    // Rapid mode draws the labels again after a pick.
    await wait_for_labels("the first pick");
    await press_keys("s");
    await wait_event(mark, loaded("hint_two"), "the second link to load after two picks");
    await wait_for_tab_count(tabs_before + 2, "two picks to open two tabs");
    await press_keys("-k", "Escape");
    await wait_for_label_count(0, "gone after Escape");
    // The barrier reaches this page only when it is still the front tab.
    await barrier("p6_rapid");
    await expect_no_tab_shown(switch_mark, "a background tab came to the front");
    await press_keys("a");
    // The scroll report of the next case's j trails by 150 ms, which gives a link opened by a stray a time to show as a tab.
    expect((await scroll_delta_by_press("p6_rapid", ["j"])) > 0, "keys did not work again after Escape");
    expect((await tab_count()) === tabs_before + 2, "a opened a link after Escape");
    await close_tabs_with("hint_one");
    await close_tabs_with("hint_two");
  });

  await run_case("rapid delete labels the page again after each pick, and ends when nothing is left", async () => {
    await open_page("hints", "p6_delete", { new_tab: true });
    expect((await link_count()) === 4, "the fixture does not hold four links");
    await run_hint({ action: "delete", filter: "links", rapid: true });
    await wait_for_label_count(2, "after the delete hint started");
    await press_keys("a");
    await wait_for_link_count(3, "the first pick to delete a link");
    // One link has a label left, so the labels were drawn again.
    await wait_for_label_count(1, "after the first pick");
    await press_keys("a");
    await wait_for_link_count(2, "the second pick to delete the next link");
    // Only the hidden and the covered link are left, so the rebuild finds nothing and hint mode ends. The key goes right after the pick and rides out the rebuild.
    expect((await scroll_delta_by_press("p6_delete", ["j"])) > 0, "hint mode did not end when no link was left");
  });

  await run_case("rapid here follows a click that removes the link", async () => {
    await open_page("hints", "p6_here", { new_tab: true });
    await in_active_tab(`for (const link of document.querySelectorAll("a[href]")) link.addEventListener("click", (event) => { event.preventDefault(); link.remove(); }); 0`);
    await run_hint({ action: "here", filter: "links", rapid: true });
    await wait_for_label_count(2, "after the here hint started");
    await press_keys("a");
    await wait_for_link_count(3, "the first pick to remove a link");
    await wait_for_label_count(1, "after the first pick");
    await press_keys("a");
    await wait_for_link_count(2, "the second pick to remove the next link");
    expect((await scroll_delta_by_press("p6_here", ["j"])) > 0, "hint mode did not end when no link was left");
  });

  await run_case("text with one match opens it at once and leaves hint mode", async () => {
    await open_page("hints", "p6_one_match", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await run_hint({ action: "background", filter: "links", text: "TWO", rapid: true });
    await wait_event(mark, loaded("hint_two"), "the matching link to load");
    await wait_for_tab_count(tabs_before + 1, "the match to open exactly one tab");
    expect((await scroll_delta_by_press("p6_one_match", ["j"])) > 0, "hint mode did not end after the one match");
    await close_tabs_with("hint_two");
  });

  await run_case("text with no match shows a notice and leaves keys alone", async () => {
    await open_page("hints", "p6_no_match", { new_tab: true });
    await run_hint({ filter: "links", text: "zzz" });
    await poll_until("the no-match notice", async () => (await notice_text()) !== "");
    expect((await scroll_delta_by_press("p6_no_match", ["j"])) > 0, "keys did not work after a text with no match");
  });

  // / inside hint mode switches from typing a label to typing the link text. The fixture links are "one" (label a) and "two" (label s).
  const hint_labels_in_order = () => in_active_tab(`[...document.documentElement.children].map((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])].map((node) => node.textContent).join(",")).join("")`);
  const text_box_shown = () => in_active_tab(`[...document.documentElement.children].some((child) => child.openOrClosedShadowRoot?.querySelector(".desertfox-hint-text"))`);

  await run_case("/ then text then Enter picks the best match", async () => {
    await open_page("hints", "p6_text_enter", { new_tab: true });
    const mark = events.length;
    await press_keys(";l");
    await wait_for_labels(";l");
    await press_keys("/", "o");
    // "o" is a word start in "one" and only inside "two", so "one" ranks first.
    await poll_until("the text box", text_box_shown);
    await press_keys("-k", "Return");
    await wait_event(mark, loaded("hint_one"), "the best match to load");
  });

  await run_case("/ then text that matches one link picks it, and the rest of the word does nothing", async () => {
    await open_page("hints", "p6_text_unique", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await run_hint({ action: "background", filter: "links" });
    await wait_for_labels("the hint");
    // "t" leaves one match. The j after it is the rest of a word and must not scroll the page as a normal key.
    await press_keys("/", "t", "j");
    await wait_event(mark, loaded("hint_two"), "the only match to load");
    await expect_absent(mark, "p6_text_unique", (event) => event.type === "scroll", "j scrolled the page after the pick", { report_delay_ms: scroll_report_wait_ms });
    expect((await tab_count()) === tabs_before + 1, "the pick did not open exactly one tab");
    await close_tabs_with("hint_two");
  });

  await run_case("/ typed right after the hint key on a fresh page switches to text and never reaches the page", async () => {
    await open_page("hints", "p6_text_first", { new_tab: true });
    const mark = events.length;
    // F opens the pick in a background tab, so this page stays to report what it saw.
    await press_keys("F", "/", "t", "w");
    await wait_event(mark, loaded("hint_two"), "the only match to load");
    await expect_absent(mark, "p6_text_first", (event) => event.type === "keydown" && event.key === "/", "/ reached the page while the hints bundle loaded", { report_delay_ms: scroll_report_wait_ms });
    await close_tabs_with("hint_two");
  });

  await run_case("Backspace on empty text returns to label mode with the labels intact", async () => {
    await open_page("hints", "p6_text_back", { new_tab: true });
    const mark = events.length;
    await press_keys(";l");
    await wait_for_labels(";l");
    await press_keys("/", "o", "-k", "BackSpace", "-k", "BackSpace");
    await poll_until("the text box to go", async () => !(await text_box_shown()));
    expect((await hint_label_count()) === 2, "the labels are not both shown");
    await press_keys("s");
    await wait_event(mark, loaded("hint_two"), "label s to pick the second link");
  });

  await run_case("Space turns overlapping labels, and keeps hint mode", async () => {
    await open_page("hints", "p6_space_rotate", { new_tab: true });
    await in_active_tab(`for (const link of document.querySelectorAll("a[href*=hint_]")) Object.assign(link.style, { position: "fixed", left: "50px", top: "50px", display: "block" }); 0`);
    await press_keys(";l");
    await wait_for_labels(";l");
    const before = await hint_labels_in_order();
    await press_keys("-k", "space");
    await poll_until("the label order to change", async () => (await hint_labels_in_order()) !== before);
    expect((await hint_label_count()) === 2, "Space left hint mode or changed the labels");
    await press_keys("-k", "Escape");
    await wait_for_label_count(0, "gone after Escape");
  });

  await run_case("rapid mode starts each round in label mode", async () => {
    await open_page("hints", "p6_text_rapid", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await run_hint({ action: "background", filter: "links", rapid: true });
    await wait_for_labels("rapid");
    // The "a" and "s" are the rest of a word. In label mode of the next round they would pick links, so only the one text pick may open a tab.
    await press_keys("/", "t", "a", "s");
    await wait_event(mark, loaded("hint_two"), "the text pick to load");
    await wait_for_labels("the first pick");
    expect(!(await text_box_shown()), "the next round is still in text mode");
    await wait_for_tab_count(tabs_before + 1, "only the text pick to open a tab");
    await press_keys("a");
    await wait_event(mark, loaded("hint_one"), "label a to pick the first link in the next round");
    await wait_for_tab_count(tabs_before + 2, "two picks to open two tabs");
    await press_keys("-k", "Escape");
    await close_tabs_with("hint_one");
    await close_tabs_with("hint_two");
  });

  // `sh` opens the command line with `heading ` typed. The list lives in the extension's frame, which the page cannot read, so these cases check what a pick does to the page.
  const toast_layer = 2147483647 - 2;
  const toast_text = async () => await in_active_tab(`(() => { const host = [...document.documentElement.children].find((child) => child.style.zIndex === "${toast_layer}"); return host?.openOrClosedShadowRoot?.textContent ?? ""; })()`);
  const scroll_y = async () => await in_active_tab(`Math.round(scrollY)`);
  const top_of = async (id) => await in_active_tab(`Math.round(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().top)`);
  const tab_key = ["-k", "Tab"];
  const enter_key = ["-k", "Return"];
  // A Tab before the list holds its rows is lost, so the line counts as open once the rows are in.
  const open_headings_line = async (row_count) => {
    await press_keys("sh");
    await wait_cmdline((line) => line.open && line.rows === row_count, `the headings line to open with ${row_count} rows`);
  };
  // The third Tab selects the third row, which is the row index 2.
  const tab_to_third_row = async () => {
    await press_keys(...tab_key, ...tab_key, ...tab_key);
    await wait_cmdline((line) => line.selected === "2", "the third row to be selected");
  };
  // The /headings page lists the title, Intro, Below the fold and Last. The hidden, closed and screen-reader-only headings are not rows.
  const run_heading = (heading) => in_active_tab(`browser.runtime.sendMessage({ type: "run", invocations: [{ id: "heading.go", args: { heading: ${JSON.stringify(heading)} } }], mode: "normal" }); 0`);

  await run_case("sh lists the headings in page order and Tab then Enter scrolls to one below the screen", async () => {
    await open_page("headings", "p6_headings", { new_tab: true });
    await open_headings_line(4);
    // With no text typed the rows keep page order: the third row is "Below the fold".
    await tab_to_third_row();
    const delta = await scroll_delta_by_press("p6_headings", enter_key);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = await top_of("below");
    expect(Math.abs(top) <= 2, `Below the fold sits ${top}px from the top`);
    expect((await scroll_delta_by_press("p6_headings", ["j"])) > 0, "keys did not work again after the jump");
  });

  await run_case("sh typing narrows the list and Enter with text takes the best match", async () => {
    await open_page("headings", "p6_headings_typed", { new_tab: true });
    await open_headings_line(4);
    await press_keys("last");
    await wait_cmdline((line) => line.open && line.value.endsWith("last") && line.rows === 1, "the typed text to narrow the list to one row");
    const delta = await scroll_delta_by_press("p6_headings_typed", enter_key);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = await top_of("last");
    expect(Math.abs(top) <= 2, `Last sits ${top}px from the top`);
  });

  await run_case("sh reaches a heading above the screen", async () => {
    await open_page("headings", "p6_headings_up", { new_tab: true });
    await scroll_delta_by_press("p6_headings_up", ["G"]);
    await open_headings_line(4);
    await type_in_line("intro");
    const delta = await scroll_delta_by_press("p6_headings_up", enter_key);
    expect(delta < 0, `the page did not scroll up, delta ${delta}`);
    const top = await top_of("intro");
    expect(Math.abs(top) <= 2, `Intro sits ${top}px from the top`);
  });

  await run_case("]h and [h move heading by heading from the view, 3]h takes a count, and the ends show a notice", async () => {
    await open_page("headings", "p6_heading_steps", { new_tab: true });
    // 3]h from the top is the third heading in page order: the title, Intro, then Below the fold.
    await press_keys("3]h");
    await poll_until("Below the fold at the top", async () => Math.abs(await top_of("below")) <= 2);
    await press_keys("]h");
    await poll_until("Last at the top", async () => Math.abs(await top_of("last")) <= 2);
    await press_keys("[h");
    await poll_until("Below the fold at the top again", async () => Math.abs(await top_of("below")) <= 2);
    await press_keys("2[h");
    await poll_until("the title at the top, which is a little below the page top for its margin", async () => (await scroll_y()) < 100 && (await top_of("intro")) > 0);
    await press_keys("[h");
    await poll_until("the notice before the first heading", async () => (await toast_text()).includes("No previous heading"));
    await press_keys("9]h");
    await poll_until("Last at the top after a count past the end", async () => Math.abs(await top_of("last")) <= 2);
    await press_keys("]h");
    await poll_until("the notice past the last heading", async () => (await toast_text()).includes("No next heading"));
  });

  await run_case("]h passes headings the page cannot scroll to the top, because it steps from the last heading it jumped to", async () => {
    await open_page("headings_end", "p6_heading_end", { new_tab: true });
    await press_keys("2]h");
    await poll_until("A at the top", async () => Math.abs(await top_of("a")) <= 2);
    await press_keys("]h");
    await poll_until("B scrolled as far as the page goes", async () => (await scroll_y()) > 1000);
    expect((await top_of("b")) > 5, "B reached the top, so the page is too short for this case");
    expect((await top_of("c")) > (await top_of("b")), "C is not below B");
    await press_keys("]h");
    const at_c = await scroll_y();
    await press_keys("]h");
    await press_keys("]h");
    await poll_until("the notice past D", async () => (await toast_text()).includes("No next heading"));
    // From D the key goes back one heading, C, which cannot reach the top either, so the page stays put.
    await press_keys("[h");
    await sleep(400);
    expect((await scroll_y()) === at_c, `[h from D moved the page from ${at_c} to ${await scroll_y()}`);
    await press_keys("2[h");
    await poll_until("A at the top again", async () => Math.abs(await top_of("a")) <= 2);
  });

  await run_case("sh jumps to a heading in a same-origin frame, skips one in a hidden frame, and scrolls the frame too", async () => {
    await open_page("headings_frames", "p6_headings_frames", { new_tab: true });
    await open_headings_line(3);
    // The rows are the title, Top and "In frame". The heading in the hidden frame is no row.
    await tab_to_third_row();
    const delta = await scroll_delta_by_press("p6_headings_frames", enter_key);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = (await in_active_tab(`(() => { const frame = document.getElementById("shown"); return Math.round(frame.getBoundingClientRect().top + frame.contentDocument.getElementById("in_frame").getBoundingClientRect().top); })()`));
    expect(Math.abs(top) <= 2, `the heading in the frame sits ${top}px from the top of the view`);
  });

  await run_case("sh closes on Escape without moving, and keys work again", async () => {
    await open_page("headings", "p6_headings_close", { new_tab: true });
    await open_headings_line(4);
    await press_keys(...tab_key);
    await wait_cmdline((line) => line.selected !== null, "a row to be selected");
    // The list is open, so the first Escape closes it and the second closes the line.
    await close_cmdline();
    expect((await scroll_y()) === 0, "Escape moved the page");
    expect((await scroll_delta_by_press("p6_headings_close", ["j"])) > 0, "keys did not work again after Escape");
  });

  await run_case("sh on a page with no headings opens the line with no rows, and Escape leaves it", async () => {
    await open_page("headings", "p6_headings_none", { new_tab: true });
    await in_active_tab(`document.querySelectorAll("h1, h2, h3, [role=heading]").forEach((heading) => heading.remove()); 0`);
    await open_headings_line(0);
    const mark = events.length;
    await press_keys("j");
    // The j in the line value is the proof that the key went to the line and not to the page.
    await wait_cmdline((line) => line.open && line.value.endsWith("j"), "j to land in the command line");
    expect(!find_event(mark, (event) => event.type === "scroll" && event.page_id === "p6_headings_none"), "j reached the page while the line was open");
    await close_cmdline();
    expect((await scroll_delta_by_press("p6_headings_none", ["j"])) > 0, "keys did not work after the line closed");
  });

  await run_case("sh then Escape drops the snapshot, so the next heading.go reads the page as it is now", async () => {
    await open_page("headings", "p6_headings_stale", { new_tab: true });
    await open_headings_line(4);
    await close_cmdline();
    // A heading that came after the first list. A snapshot that survived the Escape would not know it.
    await in_active_tab(`document.body.insertAdjacentHTML("beforeend", '<h2 id="fresh">Fresh news</h2><div style="height:3000px"></div>'); 0`);
    await run_heading("Fresh news");
    await poll_until("Fresh news to scroll to the top", async () => Math.abs(await top_of("fresh")) <= 2).catch(async (error) => { throw new Error(`Fresh news sits ${await top_of("fresh")}px from the top, so the old snapshot answered (${error.message})`); });
  });

  await run_case("sh then Enter on a heading the page removed since gives That heading is gone and does not move", async () => {
    await open_page("headings", "p6_headings_gone", { new_tab: true });
    await open_headings_line(4);
    await in_active_tab(`document.getElementById("below").remove(); 0`);
    await tab_to_third_row();
    await press_keys(...enter_key);
    await poll_until("the notice that the heading is gone", async () => (await toast_text()).includes("That heading is gone")).catch(async (error) => { throw new Error(`the notice read "${await toast_text()}" (${error.message})`); });
    expect((await scroll_y()) === 0, "the page moved for a heading that is gone");
    expect((await scroll_delta_by_press("p6_headings_gone", ["j"])) > 0, "keys did not work after the refusal");
  });

  // The selector keeps the labels fixed: #card is "a", #other is "s".
  const hover_pick = async (label, selector = "#card, #other") => {
    await run_hint({ action: "hover", filter: "custom", selector });
    await wait_for_labels("the hover hint");
    await press_keys(label);
  };
  const hover_events = (mark, page_id) => events.slice(mark).filter((event) => event.page_id === page_id && event.type.startsWith("hover_")).map((event) => `${event.type}:${event.box}`);
  const hover_in_of = (page_id, box) => (event) => event.type === "hover_in" && event.box === box && event.page_id === page_id;

  await run_case("hover opens a mouseenter-only preview and Escape closes it", async () => {
    await open_page("hoverbox", "p6_hover", { new_tab: true });
    const mark = events.length;
    await hover_pick("a");
    await wait_event(mark, hover_in_of("p6_hover", "card"), "mouseenter on the card");
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "hover_out" && event.page_id === "p6_hover", "mouseleave after Escape");
    await barrier("p6_hover");
    expect(hover_events(mark, "p6_hover").join(",") === "hover_in:card,hover_out:card", `the page saw ${hover_events(mark, "p6_hover")}`);
  });

  await run_case("a second hover clears the first once", async () => {
    await open_page("hoverbox", "p6_hover_swap", { new_tab: true });
    const mark = events.length;
    await hover_pick("a");
    await wait_event(mark, hover_in_of("p6_hover_swap", "card"), "mouseenter on the card");
    await hover_pick("s");
    await wait_event(mark, hover_in_of("p6_hover_swap", "other"), "mouseenter on the other box");
    await barrier("p6_hover_swap");
    expect(hover_events(mark, "p6_hover_swap").join(",") === "hover_in:card,hover_out:card,hover_in:other", `the page saw ${hover_events(mark, "p6_hover_swap")}`);
  });

  await run_case("hovering an item inside a hovered menu keeps the menu open", async () => {
    await open_page("hoverbox", "p6_hover_nested", { new_tab: true });
    const mark = events.length;
    await hover_pick("a", "#menu, #item");
    await wait_event(mark, hover_in_of("p6_hover_nested", "menu"), "mouseenter on the menu");
    await hover_pick("s", "#menu, #item");
    await wait_event(mark, hover_in_of("p6_hover_nested", "item"), "mouseenter on the item");
    await barrier("p6_hover_nested");
    expect(hover_events(mark, "p6_hover_nested").join(",") === "hover_in:menu,hover_in:item", `the page saw ${hover_events(mark, "p6_hover_nested")}`);
  });

  await run_case("Escape closes a hovered menu after a click on an item inside it", async () => {
    await open_page("hoverbox", "p6_hover_pick", { new_tab: true });
    const mark = events.length;
    await hover_pick("a", "#menu, #item");
    await wait_event(mark, hover_in_of("p6_hover_pick", "menu"), "mouseenter on the menu");
    await run_hint({ action: "here", filter: "custom", selector: "#menu, #item" });
    await wait_for_labels("the here hint");
    await press_keys("s");
    // The click runs in the key's handler, so the barrier key comes after it.
    await barrier("p6_hover_pick");
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "hover_out" && event.box === "menu" && event.page_id === "p6_hover_pick", "mouseleave on the menu after Escape");
  });

  // The prompt action (;:) puts the address of the pick in the command line, as `open <url>`, for editing. On /hints the label a is "one" and s is "two".
  const link_line = (id) => (line) => line.open && line.value.startsWith("open ") && line.value.endsWith(`/page?id=${id}`);

  await run_case(";:l a opens the command line holding open and the address, and Enter opens it", async () => {
    await open_page("hints", "p6_prompt_enter", { new_tab: true });
    await press_keys(";:l");
    await wait_for_labels(";:l");
    await press_keys("a");
    await wait_cmdline(link_line("hint_one"), "the line to hold the open command and the address");
    const mark = events.length;
    await press_keys("-k", "Return");
    await wait_event(mark, loaded("hint_one"), "Enter to open the address in this tab");
    await close_tabs_with("hint_one");
  });

  await run_case(";:l a then Escape leaves the page as it was and keys work again", async () => {
    await open_page("hints", "p6_prompt_escape", { new_tab: true });
    await press_keys(";:l");
    await wait_for_labels(";:l");
    await press_keys("a");
    await wait_cmdline(link_line("hint_one"), "the line to hold the open command and the address");
    await close_cmdline();
    expect((await scroll_delta_by_press("p6_prompt_escape", ["j"])) > 0, "keys did not work after Escape");
  });

  // A fresh tab has no cmdline.js yet, so the line loads on this pick. The j goes out in the same press as the label, so it arrives while the line loads: it must end up in the line, never scroll the page.
  await run_case("a key typed right after the pick lands in the line and never runs as a normal key", async () => {
    await open_page("hints", "p6_prompt_early", { new_tab: true });
    await press_keys(";:l");
    await wait_for_labels(";:l");
    const mark = events.length;
    await press_keys("a", "j");
    await wait_cmdline((line) => line.open && line.value.startsWith("open ") && line.value.endsWith("hint_onej"), "the j to land in the line after the address");
    expect(!find_event(mark, (event) => event.type === "scroll" && event.page_id === "p6_prompt_early"), "j scrolled the page");
    await close_cmdline();
  });

  await run_case(";:l with a command: a binding names the command and flags that start the line", async () => {
    await open_page("hints", "p6_prompt_command", { new_tab: true });
    await run_hint({ action: "prompt", filter: "links", command: "open --tab" });
    await wait_for_labels("the prompt hint");
    await press_keys("s");
    await wait_cmdline((line) => line.open && line.value.startsWith("open --tab ") && line.value.endsWith("/page?id=hint_two"), "the line to hold the named command");
    const before = await tab_count();
    await press_keys("-k", "Return");
    await wait_for_tab_count(before + 1, "Enter to open the address in a new tab");
    await close_tabs_with("hint_two");
  });

  await run_case(";Y collects the addresses of two picks into one clipboard list, and a repeat adds nothing", async () => {
    await open_page("hints", "p6_collect", { new_tab: true });
    await press_keys(";Y");
    await wait_for_labels(";Y");
    await press_keys("a");
    await wait_for_label_count(2, "again after the first pick");
    await press_keys("s");
    await wait_for_label_count(2, "again after the second pick");
    await press_keys("a");
    await wait_for_label_count(2, "again after a repeated pick");
    await press_keys("-k", "Escape");
    await wait_for_label_count(0, "gone after Escape");
    await open_page("field", "p6_collect_paste", { new_tab: true });
    const mark = events.length;
    await press_keys(...paste_ctrl_v);
    const pasted = (await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_collect_paste", "the pasted list")).value;
    // A one-line field turns the newline between the entries into a space.
    const lines = pasted.split(" ");
    expect(lines.length === 2 && lines[0].endsWith("/page?id=hint_one") && lines[1].endsWith("/page?id=hint_two"), `;Y copied ${JSON.stringify(pasted)}`);
  });

  // The line reads the top page's closed shadow roots, as the other hint probes do. Its box is measured in the page's own pixels.
  const key_line_state = () => in_active_tab(`(() => { const node = [...document.documentElement.children].map((child) => child.openOrClosedShadowRoot?.querySelector(".desertfox-hint-keys")).find(Boolean); if (!node) return null; const box = node.getBoundingClientRect(); return { text: node.textContent, right_gap: innerWidth - box.right, bottom_gap: innerHeight - box.bottom, top_gap: innerHeight - box.top }; })()`);

  await run_case("the key line shows bottom right, below the toast and which-key spots, and its words follow the mode", async () => {
    await open_page("hints", "p6_key_line", { new_tab: true });
    await press_keys(";l");
    await wait_for_labels(";l");
    await poll_until("the label mode line", async () => (await key_line_state())?.text?.startsWith("/: type text"));
    const state = await key_line_state();
    // The toast and the which-key panel start 48 and 44 px above the bottom edge, and the line must end below both.
    expect(state.right_gap >= 0 && state.right_gap <= 32 && state.top_gap < 44, `the key line sits at ${JSON.stringify(state)}`);
    await press_keys("/", "o");
    await poll_until("the text mode line", async () => (await key_line_state())?.text?.startsWith("Enter: pick"));
    await press_keys("-k", "Escape");
    await poll_until("the line to go", async () => (await key_line_state()) === null);
  });

  // Set DESERTFOX_SHOT_DIR to also save the two screenshots.
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  if (shot_dir) {
    await run_case("screenshot of rapid mode after a pick", async () => {
      await open_page("hints", "p6_shot_rapid", { new_tab: true });
      await send_keys(";rl");
      await send_keys("a");
      await sleep(800);
      await take_shot(`${shot_dir}/p6_rapid_after_pick.png`);
      await send_keys("-k", "Escape");
      await close_tabs_with("hint_one");
      await sleep(300);
    });

    await run_case("screenshot of the key line in label mode and text mode", async () => {
      await open_page("hints", "p6_shot_key_line", { new_tab: true });
      await press_keys(";l");
      await wait_for_labels(";l");
      await sleep(400);
      await take_shot(`${shot_dir}/p6_key_line_labels.png`);
      await press_keys("/", "o");
      await sleep(400);
      await take_shot(`${shot_dir}/p6_key_line_text.png`);
      await press_keys("-k", "Escape");
      await sleep(300);
    });

    await run_case("screenshot of the headings list", async () => {
      await open_page("headings", "p6_shot_headings", { new_tab: true });
      await send_keys("sh");
      await sleep(900);
      await take_shot(`${shot_dir}/p6_headings_list.png`);
      await send_keys("-k", "Escape");
      await send_keys("-k", "Escape");
      await sleep(300);
    });

    await run_case("screenshot of the no-match notice", async () => {
      await open_page("hints", "p6_shot_notice", { new_tab: true });
      await run_hint({ filter: "links", text: "zzz" });
      await sleep(400);
      await take_shot(`${shot_dir}/p6_no_match_notice.png`);
      await sleep(1500);
    });
  }
}
