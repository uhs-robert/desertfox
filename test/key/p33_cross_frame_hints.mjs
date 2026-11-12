// Hints across frames of another origin (`hint --all-frames`). The fixture /frames_hints holds a link in the top page, a cross-origin frame with two links in view, and a second cross-origin frame 3000 px down, outside the first viewport.
// The top page cannot read a cross-origin frame, so the label count comes from the extension's script in each frame (executeScript with allFrames).

export const areas = ["hints"];

// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;

export async function run_cases({ run_case, press_keys, poll_until, open_page, wait_event, find_event, events, expect, in_background, run_line }) {
  const labels_by_frame = async () => {
    const code = `(() => { const host = [...document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}"); return { href: location.href, labels: [...(host?.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])].map((label) => label.textContent) }; })()`;
    const frames = await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); return browser.tabs.executeScript(tab.id, { allFrames: true, code: ${JSON.stringify(code)} }); })()`);
    const by_name = { top: [], cross: [], below: [] };
    for (const frame of Array.isArray(frames) ? frames : []) {
      const name = frame?.href?.includes("/frame_links") ? (frame.href.endsWith("_below") ? "below" : "cross") : "top";
      by_name[name] = frame?.labels ?? [];
    }
    return by_name;
  };
  const total_of = (by_name) => by_name.top.length + by_name.cross.length + by_name.below.length;
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
    return wait_for_labels("the labels of the top page and the cross-origin frame", 3);
  };
  const on_page = (id, type) => (event) => event.page_id === id && event.type === type;

  // KNOWN FAILING (src bug, reported to the coordinator): after a74245ea the cross-origin frame still draws no labels. The last snapshot reads {"top":["a"],"cross":[],"below":[]}. The cases that start with --all-frames fail until a fix lands.
  await run_case("--all-frames labels the top page and the cross-origin frame with unique labels, and none in a frame below the viewport", async () => {
    const labels = await start_across_frames("fh_labels");
    expect(labels.top.length === 1, `the top page has ${labels.top.length} labels, expected 1`);
    expect(labels.cross.length === 2, `the cross-origin frame has ${labels.cross.length} labels, expected 2`);
    expect(labels.below.length === 0, `the frame below the viewport has ${labels.below.length} labels, expected none`);
    const all = [...labels.top, ...labels.cross];
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
}
