// Key cases of piece P6 (hint extras): copy, rapid mode, the text filter and the `;#` headings list. run.mjs calls run_cases with its helpers.
// The fixture page /hints has a hidden link and a covered link before the visible links "one" and "two", labelled "a" and "s".
// There is no key for the text filter yet, so its cases send the same `run` message a key sends, from the active tab.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, scroll_delta_after, became_visible, take_shot }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const tab_count = () => background(`(async () => (await browser.tabs.query({})).length)()`);
  const close_tabs_with = (text) => background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];

  // Runs code in the active tab's content script world.
  const in_active_tab = (code) => background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const run_hint = (args) => in_active_tab(`browser.runtime.sendMessage({ type: "run", invocations: [{ id: "hint.run", args: ${JSON.stringify(args)} }], mode: "normal" }); 0`);
  const link_count = async () => (await in_active_tab(`document.querySelectorAll("a[href]").length`))[0];

  await run_case(";yl a copies the link address", async () => {
    await open_page("hints", "p6_copy", { new_tab: true });
    await send_keys(";yl");
    await send_keys("a");
    await sleep(500);
    await open_page("field", "p6_paste", { new_tab: true });
    await sleep(300);
    const mark = events.length;
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_paste", "the pasted address");
    expect(pasted.value.endsWith("/page?id=hint_one"), `;yl copied "${pasted.value}"`);
  });

  await run_case(";Yp labels the elements with text of their own and copies the picked text", async () => {
    // Labels run in page order: the heading "a", "alpha text" "s", "beta text" "d". A labelled wrapper div would take "s".
    await open_page("prose", "p6_prose", { new_tab: true });
    await send_keys(";Yp");
    await send_keys("d");
    await sleep(500);
    await open_page("field", "p6_prose_paste", { new_tab: true });
    await sleep(300);
    const mark = events.length;
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_prose_paste", "the pasted text");
    expect(pasted.value === "beta text", `;Yp d copied "${pasted.value}"`);
  });

  await run_case("f opens a dropdown that opens on mousedown, with one click after the mouse events", async () => {
    await open_page("chosen", "p6_chosen", { new_tab: true });
    const mark = events.length;
    await send_keys("f");
    await send_keys("a");
    await wait_event(mark, (event) => event.type === "chosen_open" && event.page_id === "p6_chosen", "the dropdown to open on mousedown");
    await sleep(300);
    const seen = events.slice(mark).filter((event) => event.page_id === "p6_chosen" && event.type.startsWith("chosen_")).map((event) => event.type);
    const order = seen.filter((type) => type !== "chosen_open").join(",");
    expect(order === "chosen_pointerdown,chosen_mousedown,chosen_mouseup,chosen_click", `the page saw ${order}`);
    const [focused] = await in_active_tab(`document.activeElement.id`);
    expect(focused === "search", `the focus is on ${focused}, not the search field the page chose`);
  });

  await run_case(";s focuses a scroll box, then j scrolls the box and not the page", async () => {
    // The only scroll box is the side panel, so it gets the label "a". The page root is left out.
    await open_page("scrollbox", "p6_scrollbox", { new_tab: true });
    await send_keys(";s");
    await send_keys("a");
    await sleep(300);
    const [outlined] = await in_active_tab(`getComputedStyle(document.getElementById("panel")).outlineStyle`);
    expect(outlined === "solid", `the box has outline ${outlined} right after the pick`);
    const mark = events.length;
    await send_keys("j");
    const moved = await wait_event(mark, (event) => event.type === "panel_scroll" && event.page_id === "p6_scrollbox", "the panel to scroll after j");
    expect(moved.top > 0, `the panel is at ${moved.top} after j`);
    await sleep(400); // The fixture reports a page scroll 150 ms after it settles.
    expect(!find_event(mark, (event) => event.type === "scroll" && event.page_id === "p6_scrollbox"), "the page scrolled with the panel");
    await sleep(1000);
    const [after] = await in_active_tab(`[document.getElementById("panel").style.outline, document.getElementById("panel").getAttribute("tabindex")]`);
    expect(after[0] === "" && after[1] === "-1", `after the flash: inline outline "${after[0]}", tabindex ${after[1]}`);
  });

  await run_case(";s focuses a scroll box inside a shadow root, then j scrolls that box and not the page", async () => {
    await open_page("shadowbox", "p6_shadowbox", { new_tab: true });
    await send_keys(";s");
    await send_keys("a");
    await sleep(300);
    const mark = events.length;
    await send_keys("j");
    const moved = await wait_event(mark, (event) => event.type === "panel_scroll" && event.page_id === "p6_shadowbox", "the shadow panel to scroll after j");
    expect(moved.top > 0, `the shadow panel is at ${moved.top} after j`);
    await sleep(400); // The fixture reports a page scroll 150 ms after it settles.
    expect(!find_event(mark, (event) => event.type === "scroll" && event.page_id === "p6_shadowbox"), "the page scrolled with the shadow panel");
  });

  await run_case(";rl opens each pick in a background tab and keeps picking until Escape", async () => {
    await open_page("hints", "p6_rapid", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await send_keys(";rl");
    await send_keys("a");
    await send_keys("s");
    await wait_event(mark, loaded("hint_two"), "the second link to load after two picks");
    await sleep(500);
    expect((await tab_count()) === tabs_before + 2, "two picks did not open two tabs");
    expect(!find_event(mark, became_visible("hint_one")) && !find_event(mark, became_visible("hint_two")), "a background tab came to the front");
    await send_keys("-k", "Escape");
    await send_keys("a");
    await sleep(800);
    expect((await tab_count()) === tabs_before + 2, "a opened a link after Escape");
    expect((await scroll_delta_after("p6_rapid", ["j"])) > 0, "keys did not work again after Escape");
    await close_tabs_with("hint_one");
    await close_tabs_with("hint_two");
    await sleep(300);
  });

  await run_case("rapid delete labels the page again after each pick, and ends when nothing is left", async () => {
    await open_page("hints", "p6_delete", { new_tab: true });
    expect((await link_count()) === 4, "the fixture does not hold four links");
    await run_hint({ action: "delete", filter: "links", rapid: true });
    await sleep(600);
    await send_keys("a");
    await sleep(400);
    expect((await link_count()) === 3, "the first pick did not delete a link");
    await send_keys("a");
    await sleep(400);
    expect((await link_count()) === 2, "the second pick did not delete the next link");
    // Only the hidden and the covered link are left, so the rebuild finds nothing and hint mode ends.
    expect((await scroll_delta_after("p6_delete", ["j"])) > 0, "hint mode did not end when no link was left");
  });

  await run_case("rapid here follows a click that removes the link", async () => {
    await open_page("hints", "p6_here", { new_tab: true });
    await in_active_tab(`for (const link of document.querySelectorAll("a[href]")) link.addEventListener("click", (event) => { event.preventDefault(); link.remove(); }); 0`);
    await run_hint({ action: "here", filter: "links", rapid: true });
    await sleep(600);
    await send_keys("a");
    await sleep(400);
    await send_keys("a");
    await sleep(400);
    expect((await link_count()) === 2, "two picks did not remove two links");
    expect((await scroll_delta_after("p6_here", ["j"])) > 0, "hint mode did not end when no link was left");
  });

  await run_case("text with one match opens it at once and leaves hint mode", async () => {
    await open_page("hints", "p6_one_match", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await run_hint({ action: "background", filter: "links", text: "TWO", rapid: true });
    await wait_event(mark, loaded("hint_two"), "the matching link to load");
    await sleep(300);
    expect((await tab_count()) === tabs_before + 1, "the match did not open exactly one tab");
    expect((await scroll_delta_after("p6_one_match", ["j"])) > 0, "hint mode did not end after the one match");
    await close_tabs_with("hint_two");
    await sleep(300);
  });

  await run_case("text with no match shows a notice and leaves keys alone", async () => {
    await open_page("hints", "p6_no_match", { new_tab: true });
    await run_hint({ filter: "links", text: "zzz" });
    await sleep(500);
    expect((await scroll_delta_after("p6_no_match", ["j"])) > 0, "keys did not work after a text with no match");
  });

  // `;#` opens the command line with `heading ` typed. The list lives in the extension's frame, which the page cannot read, so these cases check what a pick does to the page.
  const toast_layer = 2147483647 - 2;
  const toast_text = async () => (await in_active_tab(`(() => { const host = [...document.documentElement.children].find((child) => child.style.zIndex === "${toast_layer}"); return host?.openOrClosedShadowRoot?.textContent ?? ""; })()`))[0];
  const scroll_y = async () => (await in_active_tab(`Math.round(scrollY)`))[0];
  const top_of = async (id) => (await in_active_tab(`Math.round(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().top)`))[0];
  const scrolled_since = (mark, page_id) => find_event(mark, (event) => event.type === "scroll" && event.page_id === page_id);
  const tab_key = ["-k", "Tab"];
  const enter_key = ["-k", "Return"];
  const open_headings_line = async () => {
    await send_keys(";#");
    await sleep(700);
  };
  // The /headings page lists the title, Intro, Below the fold and Last. The hidden, closed and screen-reader-only headings are not rows.
  const run_heading = (heading) => in_active_tab(`browser.runtime.sendMessage({ type: "run", invocations: [{ id: "heading.go", args: { heading: ${JSON.stringify(heading)} } }], mode: "normal" }); 0`);

  await run_case(";# lists the headings in page order and Tab then Enter scrolls to one below the screen", async () => {
    await open_page("headings", "p6_headings", { new_tab: true });
    await open_headings_line();
    // With no text typed the rows keep page order: the third row is "Below the fold".
    await send_keys(...tab_key, ...tab_key, ...tab_key);
    await sleep(200);
    const delta = await scroll_delta_after("p6_headings", enter_key);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = await top_of("below");
    expect(Math.abs(top) <= 2, `Below the fold sits ${top}px from the top`);
    expect((await scroll_delta_after("p6_headings", ["j"])) > 0, "keys did not work again after the jump");
  });

  await run_case(";# typing narrows the list and Enter with text takes the best match", async () => {
    await open_page("headings", "p6_headings_typed", { new_tab: true });
    await open_headings_line();
    await send_keys("last");
    await sleep(200);
    const delta = await scroll_delta_after("p6_headings_typed", enter_key);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = await top_of("last");
    expect(Math.abs(top) <= 2, `Last sits ${top}px from the top`);
  });

  await run_case(";# reaches a heading above the screen", async () => {
    await open_page("headings", "p6_headings_up", { new_tab: true });
    await scroll_delta_after("p6_headings_up", ["G"]);
    await open_headings_line();
    const delta = await scroll_delta_after("p6_headings_up", ["intro", ...enter_key]);
    expect(delta < 0, `the page did not scroll up, delta ${delta}`);
    const top = await top_of("intro");
    expect(Math.abs(top) <= 2, `Intro sits ${top}px from the top`);
  });

  await run_case(";# jumps to a heading in a same-origin frame, skips one in a hidden frame, and scrolls the frame too", async () => {
    await open_page("headings_frames", "p6_headings_frames", { new_tab: true });
    await open_headings_line();
    // The rows are the title, Top and "In frame". The heading in the hidden frame is no row.
    await send_keys(...tab_key, ...tab_key, ...tab_key);
    await sleep(200);
    const delta = await scroll_delta_after("p6_headings_frames", enter_key);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = (await in_active_tab(`(() => { const frame = document.getElementById("shown"); return Math.round(frame.getBoundingClientRect().top + frame.contentDocument.getElementById("in_frame").getBoundingClientRect().top); })()`))[0];
    expect(Math.abs(top) <= 2, `the heading in the frame sits ${top}px from the top of the view`);
  });

  await run_case(";# closes on Escape without moving, and keys work again", async () => {
    await open_page("headings", "p6_headings_close", { new_tab: true });
    await open_headings_line();
    await send_keys(...tab_key);
    // The list is open, so the first Escape closes it and the second closes the line.
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(300);
    expect((await scroll_y()) === 0, "Escape moved the page");
    expect((await scroll_delta_after("p6_headings_close", ["j"])) > 0, "keys did not work again after Escape");
  });

  await run_case(";# on a page with no headings opens the line with no rows, and Escape leaves it", async () => {
    await open_page("headings", "p6_headings_none", { new_tab: true });
    await in_active_tab(`document.querySelectorAll("h1, h2, h3, [role=heading]").forEach((heading) => heading.remove()); 0`);
    await open_headings_line();
    const mark = events.length;
    await send_keys("j");
    await sleep(500);
    expect(!scrolled_since(mark, "p6_headings_none"), "j reached the page while the line was open");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(300);
    expect((await scroll_delta_after("p6_headings_none", ["j"])) > 0, "keys did not work after the line closed");
  });

  await run_case(";# then Escape drops the snapshot, so the next heading.go reads the page as it is now", async () => {
    await open_page("headings", "p6_headings_stale", { new_tab: true });
    await open_headings_line();
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(300);
    // A heading that came after the first list. A snapshot that survived the Escape would not know it.
    await in_active_tab(`document.body.insertAdjacentHTML("beforeend", '<h2 id="fresh">Fresh news</h2><div style="height:3000px"></div>'); 0`);
    await run_heading("Fresh news");
    await sleep(500);
    const top = await top_of("fresh");
    expect(Math.abs(top) <= 2, `Fresh news sits ${top}px from the top, so the old snapshot answered`);
  });

  await run_case(";# then Enter on a heading the page removed since gives That heading is gone and does not move", async () => {
    await open_page("headings", "p6_headings_gone", { new_tab: true });
    await open_headings_line();
    await in_active_tab(`document.getElementById("below").remove(); 0`);
    await send_keys(...tab_key, ...tab_key, ...tab_key);
    await send_keys(...enter_key);
    await sleep(500);
    expect((await scroll_y()) === 0, "the page moved for a heading that is gone");
    const toast = await toast_text();
    expect(toast.includes("That heading is gone"), `the notice read "${toast}"`);
    expect((await scroll_delta_after("p6_headings_gone", ["j"])) > 0, "keys did not work after the refusal");
  });

  // The selector keeps the labels fixed: #card is "a", #other is "s".
  const hover_pick = (label) => run_hint({ action: "hover", filter: "custom", selector: "#card, #other" }).then(() => sleep(400)).then(() => send_keys(label));
  const hover_events = (mark, page_id) => events.slice(mark).filter((event) => event.page_id === page_id && event.type.startsWith("hover_")).map((event) => `${event.type}:${event.box}`);

  await run_case("hover opens a mouseenter-only preview and Escape closes it", async () => {
    await open_page("hoverbox", "p6_hover", { new_tab: true });
    const mark = events.length;
    await hover_pick("a");
    await wait_event(mark, (event) => event.type === "hover_in" && event.page_id === "p6_hover", "mouseenter on the card");
    await send_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "hover_out" && event.page_id === "p6_hover", "mouseleave after Escape");
    await sleep(300);
    expect(hover_events(mark, "p6_hover").join(",") === "hover_in:card,hover_out:card", `the page saw ${hover_events(mark, "p6_hover")}`);
  });

  await run_case("a second hover clears the first once", async () => {
    await open_page("hoverbox", "p6_hover_swap", { new_tab: true });
    const mark = events.length;
    await hover_pick("a");
    await hover_pick("s");
    await wait_event(mark, (event) => event.type === "hover_in" && event.box === "other" && event.page_id === "p6_hover_swap", "mouseenter on the other box");
    await sleep(300);
    expect(hover_events(mark, "p6_hover_swap").join(",") === "hover_in:card,hover_out:card,hover_in:other", `the page saw ${hover_events(mark, "p6_hover_swap")}`);
  });

  await run_case("hovering an item inside a hovered menu keeps the menu open", async () => {
    await open_page("hoverbox", "p6_hover_nested", { new_tab: true });
    const mark = events.length;
    const pick_nested = (label) => run_hint({ action: "hover", filter: "custom", selector: "#menu, #item" }).then(() => sleep(400)).then(() => send_keys(label));
    await pick_nested("a");
    await pick_nested("s");
    await wait_event(mark, (event) => event.type === "hover_in" && event.box === "item" && event.page_id === "p6_hover_nested", "mouseenter on the item");
    await sleep(300);
    expect(hover_events(mark, "p6_hover_nested").join(",") === "hover_in:menu,hover_in:item", `the page saw ${hover_events(mark, "p6_hover_nested")}`);
  });

  await run_case("Escape closes a hovered menu after a click on an item inside it", async () => {
    await open_page("hoverbox", "p6_hover_pick", { new_tab: true });
    const mark = events.length;
    await run_hint({ action: "hover", filter: "custom", selector: "#menu, #item" });
    await sleep(400);
    await send_keys("a");
    await wait_event(mark, (event) => event.type === "hover_in" && event.box === "menu" && event.page_id === "p6_hover_pick", "mouseenter on the menu");
    await run_hint({ action: "here", filter: "custom", selector: "#menu, #item" });
    await sleep(400);
    await send_keys("s");
    await sleep(300);
    await send_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "hover_out" && event.box === "menu" && event.page_id === "p6_hover_pick", "mouseleave on the menu after Escape");
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

    await run_case("screenshot of the headings list", async () => {
      await open_page("headings", "p6_shot_headings", { new_tab: true });
      await send_keys(";#");
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
