// Key cases of page search: `/`, `?`, `n` and `N`. run.mjs calls run_cases with its helpers.
// /find_page holds "needle" on the page (one, five), in a frame (two), in an open root (three) and in a closed root (four).
// The cases read the highlights from the content script's own world, with tabs.executeScript.

import { mkdirSync } from "node:fs";
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, expect, open_page, send_keys, sleep, events, wait_event, take_shot }) {
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return (await browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))[0]; })()`).then((value) => {
    if (value?.error) throw new Error(`in the tab: ${JSON.stringify(value)}`);
    return value;
  });
  // Read in the page's own world: ranges and sheets that the content script made are not readable from the script that tabs.executeScript runs. The closed root has no sheet count here, since only the content script can reach it.
  const READ_HIGHLIGHTS = `JSON.parse(window.wrappedJSObject.eval(${JSON.stringify(`JSON.stringify((() => {
    const texts = (owner, name) => { const highlight = owner?.defaultView.CSS.highlights.get(name); const found = []; highlight?.forEach((range) => found.push(range.startContainer.data.slice(0, 40))); return found; };
    const frame_document = document.getElementById("frame")?.contentDocument;
    const open = document.getElementById("open_host")?.shadowRoot;
    return {
      top_all: texts(document, "oasis-find"), top_current: texts(document, "oasis-find-current"),
      frame_all: texts(frame_document, "oasis-find"), frame_current: texts(frame_document, "oasis-find-current"),
      sheets: { top: document.adoptedStyleSheets.length, frame: frame_document?.adoptedStyleSheets.length ?? 0, open: open?.adoptedStyleSheets.length ?? 0 },
    };
  })())`)}))`;
  const total_painted = (state) => state.top_all.length + state.top_current.length + state.frame_all.length + state.frame_current.length;
  const current_of = (state) => [...state.top_current, ...state.frame_current].join("|");
  async function wait_highlights(predicate, what) {
    let state;
    for (let attempt = 0; attempt < 40; attempt++) {
      state = await in_active_tab(READ_HIGHLIGHTS);
      if (predicate(state)) return state;
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}, last state ${JSON.stringify(state)}`);
  }
  const badge_is = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;
  const last_scroll_y = (page_id) => events.filter((event) => event.type === "scroll" && event.page_id === page_id).at(-1)?.y ?? 0;
  const shot_dir = process.env.OASISFOX_SHOT_DIR;
  if (shot_dir) mkdirSync(shot_dir, { recursive: true });
  const ENTER = ["-k", "Return"];
  const ESCAPE = ["-k", "Escape"];

  await run_case("/ highlights the matches on the page, in a frame, in an open root and in a closed root", async () => {
    const page_id = "find_all";
    await open_page("find_page", page_id, { new_tab: true });
    await send_keys("/needle");
    const state = await wait_highlights((read) => total_painted(read) === 5, "five matches, four in the top document and one in the frame");
    expect(state.top_all.length + state.top_current.length === 4 && state.frame_all.length + state.frame_current.length === 1, `painted ${JSON.stringify(state)}`);
    expect(state.sheets.frame === 1 && state.sheets.open === 1 && state.sheets.top === 1, `sheets ${JSON.stringify(state.sheets)}`);
    expect(current_of(state) === "needle one", `the current match is ${current_of(state)}, expected needle one`);
    if (shot_dir) await take_shot(`${shot_dir}/find-matches.png`);
    const mark = events.length;
    await send_keys(...ENTER);
    await wait_event(mark, badge_is(page_id, "NORMAL"), "normal mode after Enter");
    const kept = await in_active_tab(READ_HIGHLIGHTS);
    expect(total_painted(kept) === 5, `Enter dropped the highlights: ${JSON.stringify(kept)}`);
  });

  await run_case("n and N step through the matches in order, across the frame and the roots, and wrap", async () => {
    const order = ["needle one", "needle two", "needle three", "needle four", "needle five"];
    const current_now = async () => current_of(await in_active_tab(READ_HIGHLIGHTS));
    const step_to = async (key, expected) => {
      await send_keys(key);
      for (let attempt = 0; attempt < 30 && (await current_now()) !== expected; attempt++) await sleep(150);
      expect((await current_now()) === expected, `after ${key} the current match is ${await current_now()}, expected ${expected}`);
    };
    // The page of the previous case is still the active tab, with the search for "needle" kept.
    for (const expected of order.slice(1)) await step_to("n", expected);
    await step_to("n", "needle one");
    await step_to("N", "needle five");
    await step_to("N", "needle four");
  });

  await run_case("? searches backward, n then goes up and N goes down", async () => {
    const page_id = "find_back";
    await open_page("find_page", page_id, { new_tab: true });
    await send_keys("?needle");
    // Nothing lies above the top of the page, so the search wraps to the last match.
    await wait_highlights((read) => current_of(read) === "needle five", "the backward search wrapped to needle five");
    await send_keys(...ENTER);
    await sleep(300);
    const current_now = async () => current_of(await in_active_tab(READ_HIGHLIGHTS));
    await send_keys("n");
    for (let attempt = 0; attempt < 30 && (await current_now()) !== "needle four"; attempt++) await sleep(150);
    expect((await current_now()) === "needle four", `n after ? gave ${await current_now()}, expected needle four`);
    await send_keys("N");
    for (let attempt = 0; attempt < 30 && (await current_now()) !== "needle five"; attempt++) await sleep(150);
    expect((await current_now()) === "needle five", `N after ? gave ${await current_now()}, expected needle five`);
  });

  await run_case("Escape clears every highlight, in the frame and the roots too, and keeps the page where the match put it", async () => {
    const page_id = "find_escape";
    await open_page("find_page", page_id, { new_tab: true });
    await send_keys("/needle");
    await wait_highlights((read) => total_painted(read) === 5, "the matches");
    await send_keys(" five");
    await wait_highlights((read) => current_of(read) === "needle five", "the match far below");
    await sleep(400);
    const scrolled_to = last_scroll_y(page_id);
    expect(scrolled_to > 500, `the page did not scroll to the far match (y ${scrolled_to})`);
    await send_keys(...ESCAPE);
    const state = await wait_highlights((read) => total_painted(read) === 0, "every highlight cleared");
    expect(Object.values(state.sheets).every((count) => count === 0), `a sheet was left behind: ${JSON.stringify(state.sheets)}`);
    await sleep(500);
    expect(last_scroll_y(page_id) === scrolled_to, `the page scrolled back to ${last_scroll_y(page_id)}`);
    // The query is kept as the last search, so n paints its one match again.
    await send_keys("n");
    await wait_highlights((read) => current_of(read) === "needle five" && total_painted(read) === 1, "n painting the kept search again");
  });

  await run_case("Escape in normal mode after Enter clears the highlights, and n brings them back from the same match", async () => {
    const page_id = "find_escape_normal";
    await open_page("find_page", page_id, { new_tab: true });
    await send_keys("/needle");
    await wait_highlights((read) => total_painted(read) === 5, "the matches");
    await send_keys(...ENTER);
    await sleep(300);
    await send_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "every highlight cleared");
    await send_keys("n");
    await wait_highlights((read) => current_of(read) === "needle two", "n from needle one onto needle two");
  });

  await run_case("Enter then / at once starts a new search that finds its matches", async () => {
    const page_id = "find_quick";
    await open_page("find_page", page_id, { new_tab: true });
    await send_keys("/needle");
    await wait_highlights((read) => total_painted(read) === 5, "the matches");
    await send_keys(...ENTER, "/", "four");
    await wait_highlights((read) => total_painted(read) === 1 && current_of(read) === "needle four", "the second search painting needle four");
    await send_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "every highlight cleared");
  });

  // Each current match's box, with the window it sits in and the frame around it, read in the page's own world.
  const READ_CURRENT_BOXES = `JSON.parse(window.wrappedJSObject.eval(${JSON.stringify(`JSON.stringify((() => {
    const box_in = (owner) => {
      const highlight = owner?.defaultView.CSS.highlights.get("oasis-find-current");
      let found;
      highlight?.forEach((range) => { const rect = range.getBoundingClientRect(); found = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, view_width: owner.defaultView.innerWidth, view_height: owner.defaultView.innerHeight }; });
      return found;
    };
    const frame = document.getElementById("frame");
    const frame_rect = frame?.getBoundingClientRect();
    return { top: box_in(document), inner: box_in(frame?.contentDocument), frame: frame_rect && { top: frame_rect.top, bottom: frame_rect.bottom }, view_width: innerWidth, view_height: innerHeight };
  })())`)}))`;

  await run_case("n and N bring each match fully into view: above, below, in a sideways scroller and in a frame", async () => {
    const page_id = "find_scroll";
    await open_page("find_scroll", page_id, { new_tab: true });
    await send_keys("/marker");
    await sleep(800);
    await send_keys(...ENTER);
    await sleep(500);
    const fully_visible = (boxes) => {
      const outer = boxes.top ?? boxes.inner;
      if (!outer) return "no current match";
      const inside = (box, width, height) => box.top >= 0 && box.bottom <= height && box.left >= 0 && box.right <= width;
      if (boxes.top && !inside(boxes.top, boxes.view_width, boxes.view_height)) return `the page box ${JSON.stringify(boxes.top)} is outside the window`;
      if (boxes.inner) {
        const inner = boxes.inner;
        if (!inside(inner, inner.view_width, inner.view_height)) return `the frame's match ${JSON.stringify(inner)} is outside the frame`;
        if (boxes.frame.top + inner.top < 0 || boxes.frame.top + inner.bottom > boxes.view_height) return `the frame's match is outside the window, frame at ${boxes.frame.top}`;
      }
      return undefined;
    };
    // Around the four matches twice, so each is reached from below and from above.
    for (let step = 0; step < 8; step++) {
      await send_keys(step % 2 === 0 ? "n" : "n");
      let problem = "not read";
      for (let attempt = 0; attempt < 20 && problem; attempt++) {
        await sleep(250);
        problem = fully_visible(await in_active_tab(READ_CURRENT_BOXES));
      }
      expect(!problem, `after n number ${step + 1}: ${problem}`);
    }
    for (let step = 0; step < 4; step++) {
      await send_keys("N");
      let problem = "not read";
      for (let attempt = 0; attempt < 20 && problem; attempt++) {
        await sleep(250);
        problem = fully_visible(await in_active_tab(READ_CURRENT_BOXES));
      }
      expect(!problem, `after N number ${step + 1}: ${problem}`);
    }
  });

  const selection_is = (page_id, text) => (event) => event.type === "selection" && event.page_id === page_id && event.text === text;
  const select_in_page = (text) => in_active_tab(`window.find(${JSON.stringify(text)})`);

  await run_case("v and V start at the search match, and a later selection takes the place", async () => {
    const page_id = "find_start";
    await open_page("find_page", page_id, { new_tab: true });
    await send_keys("/four");
    await wait_highlights((read) => current_of(read) === "needle four", "the match in the closed root");
    await send_keys(...ENTER);
    await sleep(300);
    await send_keys(...ESCAPE);
    await sleep(300);
    const mark = events.length;
    await send_keys("v");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    await wait_event(mark, selection_is(page_id, "f"), "the caret on the match four");
    await send_keys("-k", "Escape");
    const mark_visual = events.length;
    await send_keys("V");
    await wait_event(mark_visual, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark_visual, selection_is(page_id, "f"), "the selection on the match four");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    // Something selected after the match wins: the word "one" on the first screen.
    await select_in_page("one");
    await sleep(300);
    const mark_later = events.length;
    await send_keys("v");
    await wait_event(mark_later, selection_is(page_id, "o"), "the caret on the later selection, not on the match");
    await send_keys("-k", "Escape");
  });

  await run_case("a frame and a root that leave the page mid-search do not break it, while typing or on n", async () => {
    const page_id = "find_gone";
    await open_page("find_page", page_id, { new_tab: true });
    await send_keys("/needl");
    await wait_highlights((read) => total_painted(read) === 5, "the first matches");
    await in_active_tab(`document.getElementById("frame").remove(); document.getElementById("open_host").remove();`);
    await send_keys("e");
    // one, four and five are left, and the frame's highlight is gone with its document.
    const state = await wait_highlights((read) => read.top_all.length + read.top_current.length === 3, "three matches after the frame and the open root left");
    expect(current_of(state) === "needle one", `the current match is ${current_of(state)}`);
    await send_keys(...ENTER);
    await sleep(300);
    await send_keys("n");
    const after_n = await wait_highlights((read) => current_of(read) === "needle four", "n onto needle four");
    expect(after_n.top_all.length + after_n.top_current.length === 3, `painted ${JSON.stringify(after_n)}`);
  });

  await run_case("a slow scan for an old query never paints over the newer query", async () => {
    const page_id = "find_race";
    await open_page("find_big", page_id, { new_tab: true });
    // "e" has hundreds of thousands of matches and takes many slices. "ex" arrives while it scans.
    await send_keys("/ex");
    // The page may be busy with the first scan for a while, and a read through it then gets no answer.
    const read_when_idle = async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          return await in_active_tab(READ_HIGHLIGHTS);
        } catch {
          await sleep(500);
        }
      }
      throw new Error("the page never answered");
    };
    await sleep(4000);
    let state = await read_when_idle();
    for (let attempt = 0; attempt < 20 && total_painted(state) === 0; attempt++) {
      await sleep(500);
      state = await read_when_idle();
    }
    expect(total_painted(state) === 1, `${total_painted(state)} ranges painted, expected the single match of "ex"`);
    // A late paint of the old scan would land after this wait.
    await sleep(1500);
    const later = await read_when_idle();
    expect(total_painted(later) === 1, `${total_painted(later)} ranges painted a moment later, expected 1`);
    await send_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
  });
}
