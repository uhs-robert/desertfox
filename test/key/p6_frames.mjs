// Key cases of the frames hint filter (#134). A frame from another site starts its content script on its first focus, and gF returns the keys to the top page.
// The fixture page /frames holds a same-origin frame (a), a cross-origin frame (s) and a 10 px frame that gets no label.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["hints"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, poll_until, barrier, expect_absent, hint_label_count, open_page, wait_event, find_event, events, expect, sleep, scroll_of, last_scroll_y }) {
  const page_id = "p6_frames";
  const on_page = (id, type) => (event) => event.page_id === id && event.type === type;
  const script_starts = (id) => events.filter(on_page(id, "tree_read")).length;
  const press_hint_start = async (keys) => {
    await press_keys(keys);
    await poll_until(`the hint labels after ${keys}`, async () => (await hint_label_count()) > 0);
  };
  // gF hands the keys back to the top page, which reports the focus it takes.
  const press_gF = async () => {
    const mark = events.length;
    await press_keys("gF");
    await wait_event(mark, on_page(page_id, "window_focus"), "the top page to take the focus after gF");
  };

  await run_case(";f a focuses the same-origin frame, and j then scrolls that frame", async () => {
    await open_page("frames", page_id, { new_tab: true });
    await wait_event(0, on_page(`${page_id}_same`, "tree_read"), "the same-origin frame to start");
    const before_top = last_scroll_y(page_id);
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("a");
    await wait_event(mark, on_page(`${page_id}_same`, "window_focus"), "the frame to take the focus");
    await press_keys("j");
    await wait_event(mark, scroll_of(`${page_id}_same`), "j to scroll the frame");
    expect(last_scroll_y(page_id) === before_top, "j scrolled the top page");
  });

  await run_case("a cross-origin frame has no script until its first focus, then starts once", async () => {
    expect(script_starts(`${page_id}_cross`) === 0, "the cross-origin frame started before any focus");
    expect(script_starts(`${page_id}_tiny`) === 0, "the unfocused 10 px frame started");
    await press_keys("-k", "Escape");
    await press_gF();
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("s");
    await wait_event(mark, on_page(`${page_id}_cross`, "tree_read"), "the cross-origin frame to start on focus");
    // The barrier reaches the frame that holds the keys, so a second start would have shown by the time it reports.
    await barrier(`${page_id}_cross`);
    expect(script_starts(`${page_id}_cross`) === 1, `the cross-origin frame started ${script_starts(`${page_id}_cross`)} times`);
  });

  await run_case("j scrolls the cross-origin frame, and gF returns the keys to the top page", async () => {
    let mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(`${page_id}_cross`), "j to scroll the cross-origin frame");
    const before_top = last_scroll_y(page_id);
    mark = events.length;
    await press_gF();
    await press_keys("j");
    await wait_event(mark, scroll_of(page_id), "j to scroll the top page after gF");
    expect(last_scroll_y(page_id) > before_top, "the top page did not scroll after gF");
  });

  await run_case("gF on the top page does nothing", async () => {
    const mark = events.length;
    await press_keys("gF");
    await press_keys("j");
    await wait_event(mark, scroll_of(page_id), "j to scroll the top page after gF on the top page");
  });

  await run_case("the 10 px frame gets no label", async () => {
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("d");
    await press_keys("-k", "Escape");
    await poll_until("the labels to go after Escape", async () => (await hint_label_count()) === 0);
    await expect_absent(mark, page_id, on_page(`${page_id}_tiny`, "window_focus"), "the 10 px frame took the focus");
  });

  const in_top_frame = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);

  // Tab walks the frames in page order: the same-origin one, the cross-origin one, then the 10 px one, which nothing has focused yet.
  await run_case("Tab into a cross-origin frame starts its script", async () => {
    const mark = events.length;
    for (let presses = 0; presses < 4 && !find_event(mark, on_page(`${page_id}_tiny`, "window_focus")); presses++) {
      const press_mark = events.length;
      await press_keys("-k", "Tab");
      await wait_event(press_mark, (event) => event.type === "window_focus" && event.page_id.startsWith(`${page_id}_`), "a frame to take the focus after Tab");
    }
    await wait_event(mark, on_page(`${page_id}_tiny`, "tree_read"), "the 10 px frame to start on its Tab focus");
    await press_gF();
  });

  await run_case("a focused cross-origin frame that navigates keeps the keys, and once removed the top page takes them", async () => {
    let mark = events.length;
    await press_hint_start(";f");
    await press_keys("s");
    await wait_event(mark, on_page(`${page_id}_cross`, "window_focus"), "the cross-origin frame to take the focus");
    mark = events.length;
    await in_top_frame(`document.getElementById("cross").src = "http://localhost:" + location.port + "/frame_inner?id=${page_id}_moved"`);
    await wait_event(mark, on_page(`${page_id}_moved`, "tree_read"), "the navigated frame to start at once, still focused");
    // The frame gets its focus back a moment after its script starts, and j sooner is lost. Its window_focus report comes too early to wait on (tried: j was still lost).
    await sleep(300);
    await press_keys("j");
    await wait_event(mark, scroll_of(`${page_id}_moved`), "j to scroll the navigated frame");
    const before_top = last_scroll_y(page_id);
    mark = events.length;
    await in_top_frame(`document.getElementById("cross").remove()`);
    await sleep(300);
    await press_keys("j");
    await wait_event(mark, scroll_of(page_id), "j to scroll the top page after the focused frame left");
    expect(last_scroll_y(page_id) > before_top, "the top page did not scroll after the frame left");
  });
}
