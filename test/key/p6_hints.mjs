// Key cases of piece P6 (hint extras): copy, rapid mode and the text filter. run.mjs calls run_cases with its helpers.
// The fixture page /hints has a hidden link and a covered link before the visible links "one" and "two", labelled "a" and "s".
// There is no key for the text filter yet, so the cases send the same `run` message a key sends, from the active tab.
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

  await run_case(";y a copies the link address", async () => {
    await open_page("hints", "p6_copy", { new_tab: true });
    await send_keys(";y");
    await send_keys("a");
    await sleep(500);
    await open_page("field", "p6_paste", { new_tab: true });
    await sleep(300);
    const mark = events.length;
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_paste", "the pasted address");
    expect(pasted.value.endsWith("/page?id=hint_one"), `;y copied "${pasted.value}"`);
  });

  await run_case(";t labels the elements with text of their own and copies the picked text", async () => {
    // Labels run in page order: the heading "a", "alpha text" "s", "beta text" "d". A labelled wrapper div would take "s".
    await open_page("prose", "p6_prose", { new_tab: true });
    await send_keys(";t");
    await send_keys("d");
    await sleep(500);
    await open_page("field", "p6_prose_paste", { new_tab: true });
    await sleep(300);
    const mark = events.length;
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_prose_paste", "the pasted text");
    expect(pasted.value === "beta text", `;t d copied "${pasted.value}"`);
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

  await run_case(";r opens each pick in a background tab and keeps picking until Escape", async () => {
    await open_page("hints", "p6_rapid", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await send_keys(";r");
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

  // The panel is a surface host on the root element, in the hints layer. Its shadow root is closed, so the host count is what a page can see. The which-key panel and the mode badge sit in other layers.
  const hints_layer = 2147483647 - 4;
  const panel_hosts = async () => (await in_active_tab(`document.documentElement.querySelectorAll(':scope > [data-oasisfox-layer="${hints_layer}"]').length`))[0];
  const scroll_y = async () => (await in_active_tab(`Math.round(scrollY)`))[0];

  await run_case(";# lists the headings and a label scrolls to one below the screen", async () => {
    await open_page("headings", "p6_headings", { new_tab: true });
    await send_keys(";#");
    await sleep(400);
    expect((await panel_hosts()) === 1, "the headings panel did not open");
    const delta = await scroll_delta_after("p6_headings", ["d"]);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = (await in_active_tab(`Math.round(document.getElementById("below").getBoundingClientRect().top)`))[0];
    expect(Math.abs(top) <= 2, `Below the fold sits ${top}px from the top, the hidden headings may have taken labels`);
    expect((await panel_hosts()) === 0, "the panel stayed after the pick");
    expect((await scroll_delta_after("p6_headings", ["j"])) > 0, "keys did not work again after the pick");
  });

  // Reads the panel through the content script world, which sees closed shadow roots.
  const panel_read = async (expression) => (await in_active_tab(`(() => { const host = document.documentElement.querySelector(':scope > [data-oasisfox-layer="${hints_layer}"]'); const panel = host?.openOrClosedShadowRoot?.querySelector(".oasisfox-headings"); return ${expression}; })()`))[0];
  // The labels of the generator: single letters split into more until there are enough.
  const label_of_last = (count) => {
    const letters = [..."asdfghjkl"];
    const labels = [...letters];
    while (labels.length < count) { const split = labels.shift(); for (const letter of letters) labels.push(split + letter); }
    return labels[count - 1];
  };

  await run_case(";# panel scrolls with PageDown, PageUp and Ctrl+d, and a row below its edge can be picked", async () => {
    await open_page("headings_many", "p6_headings_many", { new_tab: true });
    await send_keys(";#");
    await sleep(500);
    const rows = await panel_read("panel.querySelectorAll('.oasisfox-heading-row').length");
    expect(rows === 61, `expected 61 rows (title and 60 sections), got ${rows}`);
    expect((await panel_read("panel.scrollHeight > panel.clientHeight")) === true, "the panel does not overflow, so the case proves nothing");
    await send_keys("-M", "ctrl", "d", "-m", "ctrl");
    await sleep(200);
    const after_ctrl_d = await panel_read("Math.round(panel.scrollTop)");
    expect(after_ctrl_d > 0, "Ctrl+d did not scroll the panel");
    await send_keys("-k", "Next");
    await sleep(200);
    const after_page_down = await panel_read("Math.round(panel.scrollTop)");
    expect(after_page_down > after_ctrl_d, `PageDown did not scroll the panel further, ${after_ctrl_d} then ${after_page_down}`);
    await send_keys("-k", "Prior");
    await sleep(200);
    expect((await panel_read("Math.round(panel.scrollTop)")) < after_page_down, "PageUp did not scroll the panel back");
    expect((await panel_hosts()) === 1, "a scroll key closed the panel");
    // The first letter of the last label hides the rows that do not match, so the rest fit.
    const last = label_of_last(61);
    await send_keys(last[0]);
    await sleep(200);
    const shown = await panel_read("[...panel.querySelectorAll('.oasisfox-heading-row')].filter((row) => row.style.display !== 'none').length");
    expect(shown < 61 && shown > 0, `typing a label letter left ${shown} rows`);
    await send_keys("-k", "BackSpace");
    await sleep(200);
    expect((await panel_read("[...panel.querySelectorAll('.oasisfox-heading-row')].filter((row) => row.style.display !== 'none').length")) === 61, "backspace did not restore the rows");
    const delta = await scroll_delta_after("p6_headings_many", [...last]);
    expect(delta > 0, `picking the last row did not scroll, delta ${delta}`);
    const top = (await in_active_tab(`Math.round(document.getElementById("section_59").getBoundingClientRect().top)`))[0];
    expect(Math.abs(top) <= 2 || (await in_active_tab(`scrollY + innerHeight >= document.documentElement.scrollHeight - 1`))[0], `Section 59 sits ${top}px from the top`);
  });

  await run_case(";# lists a heading in a frame, skips one in a hidden frame, and scrolls the frame too", async () => {
    await open_page("headings_frames", "p6_headings_frames", { new_tab: true });
    await send_keys(";#");
    await sleep(500);
    const rows = await panel_read("panel.querySelectorAll('.oasisfox-heading-row').length");
    expect(rows === 3, `expected 3 rows (title, Top, In frame), got ${rows}`);
    const delta = await scroll_delta_after("p6_headings_frames", ["d"]);
    expect(delta > 0, `the page did not scroll, delta ${delta}`);
    const top = (await in_active_tab(`(() => { const frame = document.getElementById("shown"); return Math.round(frame.getBoundingClientRect().top + frame.contentDocument.getElementById("in_frame").getBoundingClientRect().top); })()`))[0];
    expect(Math.abs(top) <= 2, `the heading in the frame sits ${top}px from the top of the view`);
  });

  await run_case(";# reaches a heading above the screen", async () => {
    await open_page("headings", "p6_headings_up", { new_tab: true });
    await scroll_delta_after("p6_headings_up", ["G"]);
    await send_keys(";#");
    await sleep(400);
    const delta = await scroll_delta_after("p6_headings_up", ["s"]);
    expect(delta < 0, `the page did not scroll up, delta ${delta}`);
    const top = (await in_active_tab(`Math.round(document.getElementById("intro").getBoundingClientRect().top)`))[0];
    expect(Math.abs(top) <= 2, `Intro sits ${top}px from the top`);
  });

  await run_case(";# closes on Escape without moving, and a wrong key or a second ;# keeps it open", async () => {
    await open_page("headings", "p6_headings_close", { new_tab: true });
    await send_keys(";#");
    await sleep(400);
    await send_keys("z");
    await send_keys(";#");
    await sleep(300);
    expect((await panel_hosts()) === 1, "a wrong key or a second ;# changed the panel");
    await send_keys("-k", "Escape");
    await sleep(300);
    expect((await panel_hosts()) === 0, "Escape left the panel");
    expect((await scroll_y()) === 0, "Escape moved the page");
    expect((await scroll_delta_after("p6_headings_close", ["j"])) > 0, "keys did not work again after Escape");
  });

  await run_case(";# leaves nothing behind when the page changes", async () => {
    await open_page("headings", "p6_headings_leave", { new_tab: true });
    await send_keys(";#");
    await sleep(400);
    await open_page("hints", "p6_headings_after", { new_tab: false });
    expect((await panel_hosts()) === 0, "the panel stayed on the next page");
    expect((await scroll_delta_after("p6_headings_after", ["j"])) > 0, "keys did not work on the next page");
  });

  await run_case(";# on a page with no headings opens no panel", async () => {
    await open_page("headings", "p6_headings_none", { new_tab: true });
    await in_active_tab(`document.querySelectorAll("h1, h2, h3, [role=heading]").forEach((heading) => heading.remove()); 0`);
    await send_keys(";#");
    await sleep(500);
    expect((await panel_hosts()) === 0, "an empty panel opened");
    expect((await scroll_delta_after("p6_headings_none", ["j"])) > 0, "hint mode stayed after the empty list");
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

  // Set OASISFOX_SHOT_DIR to also save the two screenshots.
  const shot_dir = process.env.OASISFOX_SHOT_DIR;
  if (shot_dir) {
    await run_case("screenshot of rapid mode after a pick", async () => {
      await open_page("hints", "p6_shot_rapid", { new_tab: true });
      await send_keys(";r");
      await send_keys("a");
      await sleep(800);
      await take_shot(`${shot_dir}/p6_rapid_after_pick.png`);
      await send_keys("-k", "Escape");
      await close_tabs_with("hint_one");
      await sleep(300);
    });

    await run_case("screenshot of the headings panel", async () => {
      await open_page("headings", "p6_shot_headings", { new_tab: true });
      await send_keys(";#");
      await sleep(600);
      await take_shot(`${shot_dir}/p6_headings_panel.png`);
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
