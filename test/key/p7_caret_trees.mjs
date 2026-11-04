// Key cases of caret and visual mode in shadow roots and frames (#44). run.mjs calls run_cases with its helpers.
// /caret_shadow reads "alpha one", then "beta two" in an open root, "gamma three" in a closed root and "delta four" in an open root inside it.
// /caret_frames reads "top head", a same-origin frame with "inner words here" and a frame inside it, "top tail", and a frame from another origin.

import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, expect, open_page, send_keys, sleep, events, wait_event }) {
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const selection_styles = `document.querySelectorAll("style").length && [...document.querySelectorAll("style")].filter((style) => style.textContent.includes("::selection")).length`;
  const selection_is = (page_id, text) => (event) => event.type === "selection" && event.page_id === page_id && event.text === text;
  const badge_is = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;
  const last_selection = (page_id) => events.filter((event) => event.type === "selection" && event.page_id === page_id).at(-1)?.text;

  // Label "a" is the only element, so it is picked at once.
  const hint_into = async (kind, page_id, flag, target) => {
    await open_page(kind, page_id, { new_tab: true });
    const mark = events.length;
    await send_keys(`:hint ${flag} --custom --selector=${target}`, "-k", "Return");
    await sleep(300);
    await send_keys("a");
    return mark;
  };

  await run_case("hint --caret starts in an open shadow root, a closed one and one nested inside it", async () => {
    for (const [target, first] of [["#open_text", "b"], ["#closed_text", "g"], ["#nested_text", "d"]]) {
      const page_id = `shadow_${target.slice(1)}`;
      const mark = await hint_into("caret_shadow", page_id, "--caret", target);
      await wait_event(mark, badge_is(page_id, "CARET"), `the CARET badge on ${target}`);
      await wait_event(mark, selection_is(page_id, first), `the caret on "${first}" in ${target}`);
      await send_keys("-k", "Escape");
    }
  });

  await run_case("w, b and j move the caret into and out of shadow roots", async () => {
    const page_id = "shadow_moves";
    const mark = await hint_into("caret_shadow", page_id, "--caret", "#before");
    await wait_event(mark, selection_is(page_id, "a"), "the caret on alpha");
    const mark_w = events.length;
    await send_keys("2w");
    await wait_event(mark_w, selection_is(page_id, "b"), "2w onto beta in the open root");
    const mark_j = events.length;
    await send_keys("j");
    await wait_event(mark_j, selection_is(page_id, "g"), "j onto gamma in the closed root");
    await send_keys("j");
    await wait_event(mark_j, selection_is(page_id, "d"), "j onto delta in the nested root");
    await send_keys("j");
    await wait_event(mark_j, selection_is(page_id, "o"), "j out to omega on the page");
    const mark_b = events.length;
    await send_keys("b");
    await wait_event(mark_b, selection_is(page_id, "f"), "b back onto four in the nested root");
    await send_keys("-k", "Escape");
  });

  await run_case("visual mode selects across a shadow boundary and copies the text", async () => {
    const page_id = "shadow_visual";
    const mark = await hint_into("caret_shadow", page_id, "--visual", "#before");
    await wait_event(mark, selection_is(page_id, "a"), "one character selected");
    await send_keys("2w");
    await send_keys("e");
    await sleep(500);
    const shown = last_selection(page_id);
    expect(shown?.includes("alpha") && shown.includes("beta"), `the selection reads ${JSON.stringify(shown)}, expected alpha through beta`);
    const mark_yank = events.length;
    await send_keys("y");
    await wait_event(mark_yank, (event) => event.type === "toast" && event.page_id === page_id, "the copied toast");
    await send_keys("-k", "Escape");
  });

  await run_case("a shadow host removed under the caret leaves caret mode working on the page", async () => {
    const page_id = "shadow_remove_host";
    const mark = await hint_into("caret_shadow", page_id, "--caret", "#open_text");
    await wait_event(mark, selection_is(page_id, "b"), "the caret on beta");
    await sleep(1500);
    const mark_w = events.length;
    await send_keys("w");
    const moved = await wait_event(mark_w, (event) => event.type === "selection" && event.page_id === page_id && event.text !== "", "a caret after the host left");
    expect(!"beta".includes(moved.text), `the caret is still on removed text: ${JSON.stringify(moved.text)}`);
    expect(!events.slice(mark_w).some(badge_is(page_id, "NORMAL")), "caret mode ended");
    await send_keys("-k", "Escape");
  });

  await run_case("j over an inline shadow host in a wrapped paragraph goes to the next screen line", async () => {
    const page_id = "inline_host";
    const mark = await hint_into("caret_inline_host", page_id, "--caret", "#first");
    await wait_event(mark, selection_is(page_id, "a"), "the caret on the first a");
    const mark_j = events.length;
    await send_keys("j");
    await wait_event(mark_j, selection_is(page_id, "c"), "j onto the start of the second screen line");
    const mark_k = events.length;
    await send_keys("k");
    await wait_event(mark_k, selection_is(page_id, "a"), "k back onto the first screen line");
    await send_keys("-k", "Escape");
  });

  await run_case("hint --caret starts in a same-origin frame, and j leaves it for the page", async () => {
    const page_id = "frames_pick";
    const mark = await hint_into("caret_frames", page_id, "--caret", "#inner_text");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    await wait_event(mark, selection_is(`${page_id}_inner`, "i"), "the caret on inner in the frame");
    const mark_w = events.length;
    await send_keys("w");
    await wait_event(mark_w, selection_is(`${page_id}_inner`, "w"), "w onto words in the frame");
    // The next line is in the frame inside it, then top tail on the page. The column stays, so k twice comes back to "w".
    const mark_j = events.length;
    await send_keys("j");
    await send_keys("j");
    await wait_event(mark_j, (event) => event.type === "selection" && event.page_id === page_id && event.text !== "", "j twice past the inner frame onto top tail");
    const mark_k = events.length;
    await send_keys("k");
    await send_keys("k");
    await wait_event(mark_k, selection_is(`${page_id}_inner`, "w"), "k twice back into the frame");
    await send_keys("-k", "Escape");
  });
  await run_case("V from the page reaches text in a frame with j", async () => {
    const page_id = "frames_plain";
    await open_page("caret_frames", page_id, { new_tab: true });
    const mark = events.length;
    await send_keys("gV");
    await wait_event(mark, selection_is(page_id, "c"), "the caret on the title");
    await send_keys("j");
    await send_keys("j");
    await send_keys("j");
    await wait_event(mark, selection_is(`${page_id}_inner`, "i"), "j into the frame's first paragraph");
    await send_keys("-k", "Escape");
    await sleep(300);
    expect(last_selection(`${page_id}_inner`) === "", "Escape left the selection in the frame");
  });

  await run_case("a frame removed under the caret leaves caret mode working on the page", async () => {
    const page_id = "frames_remove_frame";
    const mark = await hint_into("caret_frames", page_id, "--caret", "#inner_text");
    await wait_event(mark, selection_is(`${page_id}_inner`, "i"), "the caret in the frame");
    await sleep(1500);
    const mark_w = events.length;
    await send_keys("w");
    await wait_event(mark_w, (event) => event.type === "selection" && event.page_id === page_id && event.text !== "", "a caret on the page after the frame left");
    expect(!events.slice(mark_w).some(badge_is(page_id, "NORMAL")), "caret mode ended");
    const mark_escape = events.length;
    await send_keys("-k", "Escape");
    await wait_event(mark_escape, badge_is(page_id, "NORMAL"), "the NORMAL badge after Escape");
    await sleep(300);
    expect((await in_active_tab(selection_styles))[0] === 0, "selection colors are still on the page after Escape");
  });

  await run_case("caret in a tall frame that is already on screen does not scroll the page", async () => {
    const page_id = "frames_tall";
    await open_page("caret_tall_frame", page_id, { new_tab: true });
    const frame_selection = `document.getElementById("tall").contentWindow.getSelection().toString()`;
    const scroll_y = async () => (await in_active_tab("scrollY"))[0];
    // The load handler scrolls the page, so wait for that instead of a fixed time.
    for (let wait = 0; (await scroll_y()) <= 1000 && wait < 40; wait++) await sleep(150);
    const before = await scroll_y();
    expect(before > 1000, `the page did not scroll to the frame text: ${before}`);
    await send_keys("gV");
    for (let wait = 0; (await in_active_tab(frame_selection))[0] === "" && wait < 20; wait++) await sleep(150);
    expect((await in_active_tab(frame_selection))[0] !== "", "the caret did not start in the frame");
    await sleep(300);
    expect((await scroll_y()) === before, `the page scrolled from ${before} to ${await scroll_y()} with the caret already on screen`);
    await send_keys("-k", "Escape");
  });

  await run_case("hint --caret on a frame from another origin shows a notice and stays in normal mode", async () => {
    const page_id = "frames_cross";
    const mark = await hint_into("caret_frames", page_id, "--caret", "#xframe");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === page_id, "the other-site notice");
    await wait_event(mark, badge_is(page_id, "NORMAL"), "the NORMAL badge");
  });
}
