// A frame of another site that takes the focus on load with no click or key and not on a field is handed back to the top page (parked), so keys and hints work at once and one hint reaches the frame's targets.
// A frame on a field, a same-origin frame, and a frame the user clicked or tabbed into keep the keys as before. A frame is parked at its first focus only.
// The fixture is /hybrid_frames (see hybrid_pages.mjs): one frame whose kind the page id names. The frame reports its focus, blur and the close button.

import { click_element } from "./native_click.mjs";

export const areas = ["hints", "scroll", "ui"];

// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;

export async function run_cases({ run_case, press_keys, poll_until, open_page, wait_event, wait_takes_keys, find_event, events, expect, in_background, in_active_tab, rdp, sleep, badge_is, scroll_of, last_scroll_y, expect_absent, hint_label_count, read_local, run_line }) {
  const on_page = (id, type) => (event) => event.page_id === id && event.type === type;
  const frame_events = (id, type) => events.filter(on_page(id, type));

  // The labels of the top page and of the frame, read in each frame the way p33_cross_frame_hints does.
  const labels_by_frame = async () => {
    const code = `(() => { const host = [...document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}"); return { href: location.href, labels: [...(host?.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])].map((label) => label.textContent) }; })()`;
    const frames = await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); return browser.tabs.executeScript(tab.id, { allFrames: true, matchAboutBlank: true, code: ${JSON.stringify(code)} }); })()`);
    const by_name = { top: [], frame: [] };
    for (const frame of Array.isArray(frames) ? frames : []) by_name[(frame?.href ?? "").includes("/hybrid_frame?") ? "frame" : "top"] = frame?.labels ?? [];
    return by_name;
  };
  const wait_for_no_labels = (what) => poll_until(what, async () => Object.values(await labels_by_frame()).flat().length === 0);

  const click_frame = () => click_element(rdp, in_active_tab, "cross");
  // Presses Tab until the frame reports its `count`th focus. A press right after the load can miss, so it repeats.
  const tab_into_frame = async (frame_id, count) => {
    for (let presses = 0; presses < 6 && frame_events(frame_id, "frame_focus").length < count; presses++) {
      await press_keys("-k", "Tab");
      await sleep(250);
    }
    expect(frame_events(frame_id, "frame_focus").length >= count, `Tab never gave the frame its focus number ${count}`);
  };
  const j_scrolls = async (scrolled_id, other_id) => {
    const mark = events.length;
    const other_before = last_scroll_y(other_id);
    await press_keys("j");
    await wait_event(mark, scroll_of(scrolled_id), `j to scroll ${scrolled_id}`);
    expect(last_scroll_y(other_id) === other_before, `j also scrolled ${other_id}`);
  };

  const tab_mode_record = async () => {
    const tab_id = await in_background(`(async () => (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0].id)()`);
    return (await read_local(`desertfox_tab_mode_${tab_id}`)) ?? {};
  };
  // The park is the background's record of it plus the focus back in the top page. The frame's blur is no sign: Firefox can take the load focus back to the top page with no blur in the frame, and the background parks the frame all the same.
  const wait_parked = () =>
    poll_until("the background to park the frame and the top page to hold the focus", async () => (await tab_mode_record()).parked !== undefined && (await in_active_tab(`document.hasFocus() && !document.activeElement?.contentWindow`)));
  // Loads the page until its frame takes its load focus, then requires the park. Firefox does not always give a frame its load focus, so only a load without it is tried again, up to four loads.
  const load_until_parked = async (frame_id_of, load_page) => {
    for (let attempt = 0; ; attempt++) {
      const frame_id = frame_id_of(attempt);
      const focuses = frame_events(frame_id, "frame_focus").length;
      await load_page(attempt);
      const took_focus = await poll_until("the frame to take its load focus", async () => frame_events(frame_id, "frame_focus").length > focuses, { timeout_ms: 1500, expected_timeout: true }).then(() => true, () => false);
      if (took_focus) return (await wait_parked(), attempt);
      expect(attempt < 3, "the frame never took its load focus in four loads");
    }
  };
  // Opens a page whose frame focuses itself on load, each try under a new page id.
  const open_load_focus = async (name, kind = "load_focus") => {
    const id_of = (attempt) => `p6_hybrid_${name}_${kind}${attempt === 0 ? "" : `_retry${attempt}`}`;
    const attempt = await load_until_parked((n) => `${id_of(n)}_cross`, (n) => open_page("hybrid_frames", id_of(n), { new_tab: true }));
    return { id: id_of(attempt), frame_id: `${id_of(attempt)}_cross` };
  };
  const state = {};
  await run_case("a cross-origin frame that focuses itself on load is parked: j scrolls the top page and the badge is not FRAME", async () => {
    const mark = events.length;
    const opened = await open_load_focus("main");
    Object.assign(state, opened);
    await sleep(400);
    expect(frame_events(state.frame_id, "frame_focus").length === 1, `the frame took the focus ${frame_events(state.frame_id, "frame_focus").length} times: Gecko handed it back, or it was parked twice`);
    await j_scrolls(state.id, state.frame_id);
    expect(!find_event(mark, badge_is(state.id, "FRAME")), "the badge showed FRAME for a parked frame");
  });

  await run_case("f labels the page and the parked frame, and a pick in the frame acts there", async () => {
    await press_keys("f");
    let labels;
    await poll_until("labels in the top page and the parked frame", async () => (labels = await labels_by_frame()).top.length >= 1 && labels.frame.length >= 2);
    expect(labels.top.length === 1, `the top page has ${labels.top.length} labels, expected 1 (its link)`);
    const mark = events.length;
    await press_keys(labels.frame[0]);
    await wait_event(mark, on_page(state.frame_id, "frame_closed"), "the frame's close button to take the pick");
    await wait_for_no_labels("the labels to go after the pick");
    expect(!find_event(mark, on_page(state.id, "visibility")), "the top page's link was followed");
  });

  // Presses on the frame until it reports a focus after `mark`. A press right after a load or a hint can miss.
  const click_until_focused = async (frame_id, mark) => {
    for (let attempt = 0; attempt < 6 && !find_event(mark, on_page(frame_id, "frame_focus")); attempt++) {
      await click_frame();
      await sleep(300);
    }
    await wait_event(mark, on_page(frame_id, "frame_focus"), "the frame to take the focus from the click");
  };

  await run_case("a click into the parked frame enters frame mode as today, and j scrolls the frame", async () => {
    const { id, frame_id } = await open_load_focus("click");
    await sleep(400);
    const mark = events.length;
    await click_until_focused(frame_id, mark);
    await wait_event(mark, badge_is(id, "FRAME"), "the badge to show FRAME");
    await wait_takes_keys(frame_id);
    await j_scrolls(frame_id, id);
    expect((await tab_mode_record()).parked === undefined, "the click left the park record in place");
  });

  await run_case("a hint that focuses a field in the parked frame ends the park and enters frame mode", async () => {
    const { id, frame_id } = await open_load_focus("hint");
    await sleep(400);
    await run_line("hint --inputs");
    let labels;
    await poll_until("the label of the frame's field", async () => (labels = await labels_by_frame()).frame.length >= 1);
    const mark = events.length;
    await press_keys(labels.frame[0]);
    await wait_event(mark, on_page(frame_id, "frame_focus"), "the picked field's frame to take the focus");
    // The field puts the frame in insert mode, which the badge shows for the focused frame.
    await wait_event(mark, badge_is(id, "INSERT"), "the badge to show the frame's insert mode");
    expect((await tab_mode_record()).parked === undefined, "the pick left the park record in place");
  });

  await run_case("a frame that loses its load focus with no blur is parked, and a hint into its field still ends the park", async () => {
    const { id, frame_id } = await open_load_focus("lost", "lost_focus");
    await sleep(400);
    // The page reports a hidden blur over the network, so the report can come after the park.
    await poll_until("the frame to hide the blur of the top page's focus, which proves the order this case drives", async () => frame_events(frame_id, "frame_blur_hidden").length >= 1);
    await run_line("hint --inputs");
    let labels;
    await poll_until("the label of the frame's field", async () => (labels = await labels_by_frame()).frame.length >= 1);
    const mark = events.length;
    await press_keys(labels.frame[0]);
    await wait_event(mark, on_page(frame_id, "frame_focus"), "the picked field's frame to take the focus");
    await wait_event(mark, badge_is(id, "INSERT"), "the badge to show the frame's insert mode");
    await poll_until("the pick to end the park", async () => (await tab_mode_record()).parked === undefined);
  });

  await run_case("a frame is parked once: Tab into an idle frame parks it, and the next Tab enters it and it keeps the keys", async () => {
    const id = "p6_hybrid_idle_tab";
    const frame_id = `${id}_cross`;
    await open_page("hybrid_frames", id, { new_tab: true });
    await tab_into_frame(frame_id, 1);
    await poll_until("the park to blur the frame", async () => frame_events(frame_id, "frame_blur").length >= 1);
    const parked_focuses = frame_events(frame_id, "frame_focus").length;
    await tab_into_frame(frame_id, parked_focuses + 1);
    await sleep(400);
    await wait_takes_keys(frame_id);
    await j_scrolls(frame_id, id);
    expect(frame_events(frame_id, "frame_focus").length === parked_focuses + 1, "the frame was handed back again after its second focus");
  });

  await run_case("a here pick and a focus pick on a frame element enter it and are not parked", async () => {
    for (const action of ["here", "focus"]) {
      const id = `p6_hybrid_idle_pick_${action}`;
      const frame_id = `${id}_cross`;
      await open_page("hybrid_frames", id, { new_tab: true });
      await run_line(`hint --frames --${action}`);
      await poll_until("the label of the frame element", async () => (await hint_label_count()) > 0);
      const mark = events.length;
      await press_keys("a");
      await wait_event(mark, on_page(frame_id, "frame_focus"), `the frame to take the focus from the ${action} pick`);
      await sleep(500);
      expect(frame_events(frame_id, "frame_blur").length === 0, `the ${action} pick was parked`);
      await wait_event(mark, badge_is(id, "FRAME"), "the badge to show FRAME");
    }
  });

  await run_case("a frame the user clicked is never parked", async () => {
    const id = "p6_hybrid_idle_click";
    const frame_id = `${id}_cross`;
    await open_page("hybrid_frames", id, { new_tab: true });
    const mark = events.length;
    for (let attempt = 0; attempt < 6 && !find_event(mark, on_page(frame_id, "frame_focus")); attempt++) {
      await click_frame();
      await sleep(300);
    }
    await wait_takes_keys(frame_id);
    await j_scrolls(frame_id, id);
    expect(frame_events(frame_id, "frame_blur").length === 0, "the clicked frame was blurred");
  });

  await run_case("a frame that focuses a text field keeps the keys", async () => {
    const id = "p6_hybrid_field";
    const frame_id = `${id}_cross`;
    await open_page("hybrid_frames", id, { new_tab: true, keys_page_id: frame_id });
    const mark = events.length;
    await press_keys("j");
    await wait_event(mark, (event) => event.type === "keydown" && event.key === "j" && event.page_id === frame_id, "the frame to get the typed key");
    expect(!find_event(mark, (event) => event.page_id === id && event.type === "keydown"), "the top page got the key");
    expect(frame_events(frame_id, "frame_blur").length === 0, "the frame with the field was blurred");
  });

  await run_case("a same-origin frame that focuses itself keeps the keys", async () => {
    const id = "p6_hybrid_same";
    const frame_id = `${id}_same`;
    await open_page("hybrid_frames", id, { new_tab: true, keys_page_id: frame_id });
    await j_scrolls(frame_id, id);
    expect(frame_events(frame_id, "frame_blur").length === 0, "the same-origin frame was blurred");
  });

  await run_case("a parked frame that is removed adds no label, and f answers without the wait for it", async () => {
    await open_load_focus("gone");
    await sleep(400);
    await in_active_tab(`document.getElementById("cross").remove(); 0`);
    const started = Date.now();
    await press_keys("f");
    await poll_until("the labels of the top page", async () => (await hint_label_count()) > 0);
    expect(Date.now() - started < 450, `f waited ${Date.now() - started} ms for a frame that is gone`);
    const labels = await labels_by_frame();
    expect(labels.frame.length === 0, "a label came from a frame that is gone");
    await press_keys("-k", "Escape");
    await wait_for_no_labels("the labels to go");
  });

  await run_case("a frame that navigates after the park keeps its place in the hints, and is not parked again", async () => {
    const { id, frame_id } = await open_load_focus("nav");
    await sleep(400);
    await in_active_tab(`document.getElementById("cross").src = document.getElementById("cross").src.replace("kind=load_focus", "kind=idle"); 0`);
    await poll_until("the new frame page to report a load", async () => frame_events(frame_id, "frame_load").length >= 2);
    await sleep(300);
    await press_keys("f");
    let labels;
    await poll_until("labels in the navigated frame", async () => (labels = await labels_by_frame()).frame.length >= 2).catch(async (error) => {
      const tab_id = await in_background(`(async () => (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0].id)()`);
      throw new Error(`${error.message}; labels ${JSON.stringify(labels)}; record ${JSON.stringify(await read_local(`desertfox_tab_mode_${tab_id}`))}; frame events ${JSON.stringify(events.filter((event) => event.page_id === frame_id).map((event) => event.type))}`);
    });
    expect(frame_events(frame_id, "frame_focus").length === 1, "the navigated frame took the focus again");
    await press_keys("-k", "Escape");
    await wait_for_no_labels("the labels to go");
    await j_scrolls(id, frame_id);
  });

  await run_case("a reload of the top page parks its frame again, and closing the tab removes the record", async () => {
    const { id, frame_id } = await open_load_focus("reload");
    await sleep(400);
    await load_until_parked(() => frame_id, async () => {
      const mark = events.length;
      await in_active_tab(`location.reload(); 0`);
      await wait_event(mark, on_page(id, "tree_read"), "the reloaded page to start");
    });
    await sleep(300);
    await j_scrolls(id, frame_id);
    const tab_id = await in_background(`(async () => (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0].id)()`);
    const key = `desertfox_tab_mode_${tab_id}`;
    expect(Boolean(await read_local(key)), "no record for the parked tab");
    await in_background(`browser.tabs.remove(${tab_id}).then(() => true)`);
    await poll_until("the record of the closed tab to go", async () => (await read_local(key)) == null);
  });
}
