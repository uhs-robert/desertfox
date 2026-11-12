// Key cases of caret and visual mode in shadow roots and frames (#44). run.mjs calls run_cases with its helpers.
// /caret_shadow reads "alpha one", then "beta two" in an open root, "gamma three" in a closed root and "delta four" in an open root inside it.
// /caret_frames reads "top head", a same-origin frame with "inner words here" and a frame inside it, "top tail", and a frame from another origin.

export const areas = ["caret"];

export async function run_cases({ run_case, expect, open_page, press_keys, poll_until, sleep, scroll_report_wait_ms, scroll_of, last_scroll_y, events, wait_event, in_active_tab, badge_is, escape_to_normal, hint_label_count, run_line }) {
  const selection_styles = `[document, ...[...document.querySelectorAll("*")].map((element) => element.shadowRoot), ...[...document.querySelectorAll("iframe")].map((frame) => frame.contentDocument)].filter(Boolean).flatMap((tree) => [...tree.adoptedStyleSheets]).filter((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes("::selection"))).length`;
  const selection_is = (page_id, text) => (event) => event.type === "selection" && event.page_id === page_id && event.text === text;
  const last_selection = (page_id) => events.filter((event) => event.type === "selection" && event.page_id === page_id).at(-1)?.text;

  const page_has = (code) => async () => (await in_active_tab(code)) === true;

  // Label "a" is the only element, so it is picked at once.
  const hint_into = async (kind, page_id, flag, target) => {
    await open_page(kind, page_id, { new_tab: true });
    const mark = events.length;
    await run_line(`:hint ${flag} --custom --selector=${target}`);
    await poll_until("the hint labels to show", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    return mark;
  };

  // A key that moves the caret reports a selection change on the page or in one of its frames.
  // Unlike the harness press_and_wait_for_move, this takes a selection report from a frame of the page too: a frame reports under the page id plus a suffix.
  const press_and_wait_for_move_in_tree = async (page_id, key, what) => {
    const mark = events.length;
    await press_keys(key);
    await wait_event(mark, (event) => event.type === "selection" && event.page_id.startsWith(page_id), what);
  };

  // The caret colors move into adopted sheets, so first prove that `::selection` works from one in a shadow root and in a frame.
  await run_case("an adopted sheet with a ::selection rule colors the selection in an open shadow root and in a frame", async () => {
    await open_page("caret_shadow", "adopted_shadow", { new_tab: true });
    const in_root = await in_active_tab(`(() => {
      const root = document.getElementById("open_host").shadowRoot;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync("::selection{background:rgb(1, 2, 3) !important}");
      root.adoptedStyleSheets.push(sheet);
      return getComputedStyle(root.getElementById("open_text"), "::selection").backgroundColor;
    })()`);
    expect(in_root === "rgb(1, 2, 3)", `the open shadow root selection color is ${in_root}`);
    await open_page("caret_frames", "adopted_frame", { new_tab: true });
    const in_frame = await in_active_tab(`(() => {
      const frame_window = document.getElementById("frame").contentWindow;
      const frame_document = frame_window.document;
      const sheet = new frame_window.CSSStyleSheet();
      sheet.replaceSync("::selection{background:rgb(1, 2, 3) !important}");
      frame_document.adoptedStyleSheets.push(sheet);
      return getComputedStyle(frame_document.querySelector("p"), "::selection").backgroundColor;
    })()`);
    expect(in_frame === "rgb(1, 2, 3)", `the frame selection color is ${in_frame}`);
  });

  await run_case("hint --caret starts in an open shadow root, a closed one and one nested inside it", async () => {
    for (const [target, first] of [["#open_text", "b"], ["#closed_text", "g"], ["#nested_text", "d"]]) {
      const page_id = `shadow_${target.slice(1)}`;
      const mark = await hint_into("caret_shadow", page_id, "--caret", target);
      await wait_event(mark, badge_is(page_id, "CARET"), `the CARET badge on ${target}`);
      await wait_event(mark, selection_is(page_id, first), `the caret on "${first}" in ${target}`);
      await escape_to_normal(page_id);
    }
  });

  await run_case("w, b and j move the caret into and out of shadow roots", async () => {
    const page_id = "shadow_moves";
    const mark = await hint_into("caret_shadow", page_id, "--caret", "#before");
    await wait_event(mark, selection_is(page_id, "a"), "the caret on alpha");
    const mark_w = events.length;
    await press_keys("2w");
    await wait_event(mark_w, selection_is(page_id, "b"), "2w onto beta in the open root");
    const mark_j = events.length;
    await press_keys("j");
    await wait_event(mark_j, selection_is(page_id, "g"), "j onto gamma in the closed root");
    await press_keys("j");
    await wait_event(mark_j, selection_is(page_id, "d"), "j onto delta in the nested root");
    await press_keys("j");
    await wait_event(mark_j, selection_is(page_id, "o"), "j out to omega on the page");
    const mark_b = events.length;
    await press_keys("b");
    await wait_event(mark_b, selection_is(page_id, "f"), "b back onto four in the nested root");
    await escape_to_normal(page_id);
  });

  await run_case("visual mode selects across a shadow boundary and copies the text", async () => {
    const page_id = "shadow_visual";
    const mark = await hint_into("caret_shadow", page_id, "--visual", "#before");
    await wait_event(mark, selection_is(page_id, "a"), "one character selected");
    await press_and_wait_for_move_in_tree(page_id, "2w", "2w to move the selection");
    const mark_e = events.length;
    await press_keys("e");
    const shown = await wait_event(mark_e, (event) => event.type === "selection" && event.page_id === page_id, "e to move the selection");
    expect(shown.text.includes("alpha") && shown.text.includes("beta"), `the selection reads ${JSON.stringify(shown.text)}, expected alpha through beta`);
    const mark_yank = events.length;
    await press_keys("y");
    await wait_event(mark_yank, (event) => event.type === "toast" && event.page_id === page_id, "the copied toast");
    await escape_to_normal(page_id);
  });

  await run_case("a shadow host removed under the caret leaves caret mode working on the page", async () => {
    const page_id = "shadow_remove_host";
    const mark = await hint_into("caret_shadow", page_id, "--caret", "#open_text");
    await wait_event(mark, selection_is(page_id, "b"), "the caret on beta");
    // The page removes the host a second after the caret enters it.
    await poll_until("the page to remove the shadow host", page_has(`!document.getElementById("open_host")`), { timeout_ms: 5000 });
    const mark_w = events.length;
    await press_keys("w");
    const moved = await wait_event(mark_w, (event) => event.type === "selection" && event.page_id === page_id && event.text !== "", "a caret after the host left");
    expect(!"beta".includes(moved.text), `the caret is still on removed text: ${JSON.stringify(moved.text)}`);
    expect(!events.slice(mark_w).some(badge_is(page_id, "NORMAL")), "caret mode ended");
    await escape_to_normal(page_id);
  });

  await run_case("j over an inline shadow host in a wrapped paragraph goes to the next screen line", async () => {
    const page_id = "inline_host";
    const mark = await hint_into("caret_inline_host", page_id, "--caret", "#first");
    await wait_event(mark, selection_is(page_id, "a"), "the caret on the first a");
    const mark_j = events.length;
    await press_keys("j");
    await wait_event(mark_j, selection_is(page_id, "c"), "j onto the start of the second screen line");
    const mark_k = events.length;
    await press_keys("k");
    await wait_event(mark_k, selection_is(page_id, "a"), "k back onto the first screen line");
    await escape_to_normal(page_id);
  });

  await run_case("hint --caret starts in a same-origin frame, and j leaves it for the page", async () => {
    const page_id = "frames_pick";
    const mark = await hint_into("caret_frames", page_id, "--caret", "#inner_text");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    await wait_event(mark, selection_is(`${page_id}_inner`, "i"), "the caret on inner in the frame");
    const mark_w = events.length;
    await press_keys("w");
    await wait_event(mark_w, selection_is(`${page_id}_inner`, "w"), "w onto words in the frame");
    // The next line is in the frame inside it, then top tail on the page. The column stays, so k twice comes back to "w".
    await press_and_wait_for_move_in_tree(page_id, "j", "the first j to leave the line in the frame");
    const mark_j = events.length;
    await press_keys("j");
    await wait_event(mark_j, (event) => event.type === "selection" && event.page_id === page_id && event.text !== "", "j twice past the inner frame onto top tail");
    await press_and_wait_for_move_in_tree(page_id, "k", "the first k to leave top tail");
    const mark_k = events.length;
    await press_keys("k");
    await wait_event(mark_k, selection_is(`${page_id}_inner`, "w"), "k twice back into the frame");
    await escape_to_normal(page_id);
  });
  await run_case("V from the page reaches text in a frame with j", async () => {
    const page_id = "frames_plain";
    await open_page("caret_frames", page_id, { new_tab: true });
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, selection_is(page_id, "c"), "the caret on the title");
    for (const press of ["first", "second", "third"]) await press_and_wait_for_move_in_tree(page_id, "j", `the ${press} j to move the caret`);
    await wait_event(mark, selection_is(`${page_id}_inner`, "i"), "j into the frame's first paragraph");
    await escape_to_normal(page_id);
    await poll_until("Escape to clear the selection in the frame", () => last_selection(`${page_id}_inner`) === "");
  });

  await run_case("a frame removed under the caret leaves caret mode working on the page", async () => {
    const page_id = "frames_remove_frame";
    const mark = await hint_into("caret_frames", page_id, "--caret", "#inner_text");
    await wait_event(mark, selection_is(`${page_id}_inner`, "i"), "the caret in the frame");
    // The frame removes itself a second after the caret enters it.
    await poll_until("the frame to leave the page", page_has(`!document.getElementById("frame")`), { timeout_ms: 5000 });
    const mark_w = events.length;
    await press_keys("w");
    await wait_event(mark_w, (event) => event.type === "selection" && event.page_id === page_id && event.text !== "", "a caret on the page after the frame left");
    expect(!events.slice(mark_w).some(badge_is(page_id, "NORMAL")), "caret mode ended");
    await escape_to_normal(page_id);
    await poll_until("the selection colors to leave the page after Escape", async () => (await in_active_tab(selection_styles)) === 0);
  });

  await run_case("caret in a tall frame that is already on screen does not scroll the page", async () => {
    const page_id = "frames_tall";
    await open_page("caret_tall_frame", page_id, { new_tab: true, keys_page_id: `${page_id}_frame` });
    const frame_selection = `document.getElementById("tall").contentWindow.getSelection().toString()`;
    const scroll_y = async () => await in_active_tab("scrollY");
    // The load handler scrolls the page. Its scroll report comes after the scroll, so the wait is for the report: a later scroll event is then the caret's.
    await poll_until("the page to report its scroll to the frame text", () => last_scroll_y(page_id) > 1000);
    const before = await scroll_y();
    const mark = events.length;
    await press_keys("gV");
    await poll_until("the caret to start in the frame", async () => (await in_active_tab(frame_selection)) !== "");
    // A wrong scroll of the page is reported scroll_report_wait_ms after its cause, so that is the wait. A barrier in the frame would come sooner than the report.
    await sleep(scroll_report_wait_ms);
    expect(!events.slice(mark).some(scroll_of(page_id)), "the page scrolled with the caret already on screen");
    expect((await scroll_y()) === before, `the page scrolled from ${before} to ${await scroll_y()} with the caret already on screen`);
    // The frame holds the focus and reports only keydowns, so the frame's own selection shows that Escape arrived.
    await press_keys("-k", "Escape");
    await poll_until("Escape to clear the selection in the frame", async () => (await in_active_tab(frame_selection)) === "");
  });

  await run_case("hint --caret on a frame from another origin shows a notice and stays in normal mode", async () => {
    const page_id = "frames_cross";
    const mark = await hint_into("caret_frames", page_id, "--caret", "#xframe");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === page_id, "the other-site notice");
    await wait_event(mark, badge_is(page_id, "NORMAL"), "the NORMAL badge");
  });
}
