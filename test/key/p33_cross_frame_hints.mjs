// Hints across frames of another origin (`hint --all-frames`). The fixture /frames_hints holds a link in the top page, a same-origin frame with two links and an about:blank frame with one, which the top page labels with its own walk, a cross-origin frame with two links in view, and a second cross-origin frame 3000 px down, outside the first viewport.
// The top page cannot read a cross-origin frame, so the label count comes from the extension's script in each frame (executeScript with allFrames).

export const areas = ["hints"];

// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;

export async function run_cases({ run_case, press_keys, poll_until, open_page, wait_event, find_event, events, expect, in_background, run_line }) {
  // `read_label` runs in each frame on one label node and returns what to keep of it.
  const read_frames = async (read_label) => {
    const code = `(() => { const host = [...document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}"); return { href: location.href, labels: [...(host?.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])].map(${read_label}) }; })()`;
    const frames = await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); return browser.tabs.executeScript(tab.id, { allFrames: true, matchAboutBlank: true, code: ${JSON.stringify(code)} }); })()`);
    const by_name = { top: [], same: [], blank: [], cross: [], below: [] };
    const name_of = (href = "") => (href === "about:blank" ? "blank" : href.includes("/frame_links") ? ["below", "same", "cross"].find((name) => href.endsWith(`_${name}`)) : href.includes("/frame_field") ? "cross" : "top");
    for (const frame of Array.isArray(frames) ? frames : []) by_name[name_of(frame?.href)] = frame?.labels ?? [];
    return by_name;
  };
  const labels_by_frame = () => read_frames("(label) => label.textContent");
  // Text mode hides the labels outside the matches with display none, and marks the active one with a background.
  const shown_by_frame = () => read_frames(`(label) => ({ text: label.textContent, hidden: label.style.display === "none", active: label.style.background !== "" })`);
  const total_of = (by_name) => Object.values(by_name).flat().length;
  const wait_for_labels = async (what, wanted_total) => {
    let last;
    // The last snapshot names which frame drew nothing.
    await poll_until(what, async () => total_of((last = await labels_by_frame())) >= wanted_total).catch((error) => {
      throw new Error(`${error.message}; labels per frame at the end: ${JSON.stringify(last)}`);
    });
    return last;
  };
  const wait_for_no_labels = (what) => poll_until(what, async () => total_of(await labels_by_frame()) === 0);
  const start_across_frames = async (page_id) => {
    await open_page("frames_hints", page_id, { new_tab: true });
    await run_line("hint --links --all-frames");
    return wait_for_labels("the labels of the top page and the cross-origin frame", 6);
  };
  // run_in_console answers {error} when the promise rejects, so a clipboard that is busy reads as empty and the poll goes on.
  const clipboard_text = async () => {
    const text = await in_background("navigator.clipboard.readText()");
    return typeof text === "string" ? text : "";
  };
  const on_page = (id, type) => (event) => event.page_id === id && event.type === type;

  await run_case("--all-frames labels every element once, across the top page, its readable frames and the cross-origin frame, and none in a frame below the viewport", async () => {
    const mark = events.length;
    await start_across_frames("fh_labels");
    // The frame below never had the focus, so its content script starts for the hints: proof that it took part.
    await wait_event(mark, on_page("fh_labels_below", "tree_read"), "the frame below the viewport to start its content script");
    // A frame that labels late still shows here.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const labels = await labels_by_frame();
    // The top page draws the labels of its own link and of the same-origin and about:blank frames, which draw none themselves.
    expect(labels.top.length === 4, `the top page has ${labels.top.length} labels, expected 4 (its link, two in the same-origin frame, one in the about:blank frame)`);
    expect(labels.same.length === 0 && labels.blank.length === 0, `a frame the top page reads drew labels of its own: ${JSON.stringify(labels)}`);
    expect(labels.cross.length === 2, `the cross-origin frame has ${labels.cross.length} labels, expected 2`);
    expect(labels.below.length === 0, `the frame below the viewport has ${labels.below.length} labels, expected none`);
    const all = Object.values(labels).flat();
    expect(new Set(all).size === all.length, `the labels repeat across frames: ${all.join(" ")}`);
  });

  await run_case("Escape ends hint mode in every frame", async () => {
    await press_keys("-k", "Escape");
    await wait_for_no_labels("the labels of every frame to go after Escape");
  });

  await run_case("a pick in the cross-origin frame acts in that frame", async () => {
    const labels = await start_across_frames("fh_pick");
    const mark = events.length;
    await press_keys(labels.cross[0]);
    await wait_event(mark, (event) => event.type === "visibility" && event.page_id.startsWith("fh_pick_cross_"), "the cross-origin frame to follow the picked link");
    // Long enough for a top page that followed its own link too to report it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(!find_event(mark, on_page("fh_pick_top", "visibility")), "the top page's link was followed too");
    await wait_for_no_labels("the labels of every frame to go after the pick");
  });

  await run_case("without the flag the cross-origin frame gets no labels", async () => {
    await open_page("frames_hints", "fh_default", { new_tab: true });
    await press_keys("f");
    await poll_until("the labels of the top page after f", async () => (await labels_by_frame()).top.length > 0);
    const labels = await labels_by_frame();
    expect(labels.cross.length === 0 && labels.below.length === 0, `a cross-origin frame got labels without the flag: ${JSON.stringify(labels)}`);
    await press_keys("-k", "Escape");
    await wait_for_no_labels("the labels to go after Escape");
  });

  await run_case("text mode across frames shows the labels of the matches in every frame, and Tab moves the active hint to the cross-origin frame", async () => {
    await start_across_frames("fh_text");
    // Both the same-origin frame and the cross-origin frame hold a link "one", and only the cross-origin one gets its hide or show from the relay.
    await press_keys("/", "o", "n", "e");
    const shown_of = (frame) => frame.filter((label) => !label.hidden);
    let shown;
    await poll_until("one label left in the cross-origin frame", async () => shown_of((shown = await shown_by_frame()).cross).length === 1);
    expect(shown.top.filter((label) => !label.hidden).length === 1, `the top page shows ${JSON.stringify(shown.top)}, expected its one match for "one" (in the same-origin frame, which it reads)`);
    for (let tabs = 0; tabs < 4 && !shown.cross.some((label) => label.active); tabs++) {
      await press_keys("-k", "Tab");
      await new Promise((resolve) => setTimeout(resolve, 150));
      shown = await shown_by_frame();
    }
    expect(shown.cross.some((label) => label.active), `Tab never made the cross-origin label active: ${JSON.stringify(shown)}`);
    const mark = events.length;
    await press_keys("-k", "Return");
    await wait_event(mark, (event) => event.type === "visibility" && event.page_id === "fh_text_cross_one", "the cross-origin frame to follow the link text mode picked");
    await wait_for_no_labels("the labels of every frame to go after the pick");
  });

  await run_case("a rapid copy of text joins the picks of the cross-origin frame and the top page into one clipboard list", async () => {
    await open_page("frames_hints", "fh_rapid", { new_tab: true });
    await in_background(`navigator.clipboard.writeText("seed").then(() => true)`);
    await run_line("hint --links --all-frames --rapid --copy-text");
    let labels = await wait_for_labels("the labels of every frame", 6);
    // A pick in the cross-origin frame, then one in the top page: the rapid list lives in the keyboard frame and takes both.
    await press_keys(labels.cross[0]);
    labels = await wait_for_labels("the labels again after the cross-origin pick", 6);
    await press_keys(labels.top[0]);
    let lines = [];
    await poll_until("the clipboard to hold two lines", async () => (lines = (await clipboard_text()).split("\n")).length === 2);
    expect(lines[0] !== lines[1] && lines[0] !== "seed", `the clipboard holds ${JSON.stringify(lines)}, expected two different picks`);
    await press_keys("-k", "Escape");
    await wait_for_no_labels("the labels to go after Escape");
  });

  await run_case("a pick of a field in the cross-origin frame focuses it there, and the keys typed after it reach the field", async () => {
    await open_page("frames_field", "fh_field", { new_tab: true });
    await run_line("hint --inputs --all-frames");
    const labels = await wait_for_labels("the label of the field in the cross-origin frame", 1);
    const mark = events.length;
    await press_keys(labels.cross[0]);
    await wait_event(mark, (event) => event.type === "window_focus" && event.page_id === "fh_field_cross", "the cross-origin frame to take the window focus");
    await press_keys("h", "i");
    await wait_event(mark, (event) => event.type === "input" && event.page_id === "fh_field_cross" && event.value === "hi", "the typed text in the cross-origin field");
    await press_keys("-k", "Escape");
  });

  await run_case("hint --caret across frames starts the caret in the cross-origin frame, and its keys move it there", async () => {
    await open_page("frames_field", "fh_caret", { new_tab: true });
    await run_line("hint --caret --all-frames --custom --selector=#cross_text");
    const labels = await wait_for_labels("the label of the text in the cross-origin frame", 1);
    const mark = events.length;
    await press_keys(labels.cross[0]);
    await wait_event(mark, (event) => event.type === "selection" && event.page_id === "fh_caret_cross", "the caret to start in the cross-origin frame");
    const moved = events.length;
    await press_keys("w");
    await wait_event(moved, (event) => event.type === "selection" && event.page_id === "fh_caret_cross" && event.text === "i", "w to move the caret onto the next word in the cross-origin frame");
    await press_keys("-k", "Escape");
  });
}
