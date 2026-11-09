// Key cases of page search: `/`, `?`, `n` and `N`. run.mjs calls run_cases with its helpers.
// /find_page holds "needle" on the page (one, five), in a frame (two), in an open root (three) and in a closed root (four).
// The cases read the highlights from the content script's own world, with tabs.executeScript.

import { mkdirSync } from "node:fs";
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["find"];

export async function run_cases({ rdp, extension_id, run_case, expect, expect_absent, open_page, press_keys, poll_until, barrier, wait_cmdline, close_cmdline, read_cmdline_state, scroll_of, scroll_report_wait_ms, sleep, events, wait_event, take_shot, in_active_tab, badge_is, is_selection_of, press_and_wait_for_move, escape_to_normal, type_in_line }) {
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
  // A page busy with a long scan answers no read, so a failed read counts as "not yet" and the timeout error names the last state or failure.
  async function poll_reads(read, predicate, what, timeout_ms = 6000) {
    let last;
    try {
      await poll_until(what, async () => {
        try {
          last = await read();
        } catch (error) {
          last = `read failed: ${error.message}`;
          return false;
        }
        return predicate(last);
      }, { timeout_ms });
    } catch (error) {
      throw new Error(`${error.message}, last read ${JSON.stringify(last)}`);
    }
    return last;
  }
  const wait_highlights = (predicate, what, timeout_ms) => poll_reads(() => in_active_tab(READ_HIGHLIGHTS), predicate, what, timeout_ms);
  const last_scroll_y = (page_id) => events.filter((event) => event.type === "scroll" && event.page_id === page_id).at(-1)?.y ?? 0;
  // Types a search into the line and waits until the line holds the text.
  async function type_search(typed) {
    await press_keys(typed);
    const [, text] = /^[/?]?(.*)$/s.exec(typed);
    await wait_cmdline((line) => line.open && line.value === text, `the search line to hold ${JSON.stringify(text)}`);
  }
  async function press_enter_and_wait_for_close() {
    await press_keys(...ENTER);
    await wait_cmdline((line) => !line.open, "the search line to close after Enter");
  }
  // The current match as the highlights name it. A key that steps to another match changes it, so the wait is for a new name.
  async function press_and_wait_for_new_current(keys) {
    const before = current_of(await in_active_tab(READ_HIGHLIGHTS));
    await press_keys(keys);
    return wait_highlights((read) => current_of(read) !== before && current_of(read) !== "", `${keys} to make another match current than ${before}`);
  }
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  if (shot_dir) mkdirSync(shot_dir, { recursive: true });
  const ENTER = ["-k", "Return"];
  const ESCAPE = ["-k", "Escape"];

  await run_case("/ highlights the matches on the page, in a frame, in an open root and in a closed root", async () => {
    const page_id = "find_all";
    await open_page("find_page", page_id, { new_tab: true });
    await press_keys("/needle");
    const state = await wait_highlights((read) => total_painted(read) === 5, "five matches, four in the top document and one in the frame");
    expect(state.top_all.length + state.top_current.length === 4 && state.frame_all.length + state.frame_current.length === 1, `painted ${JSON.stringify(state)}`);
    expect(state.sheets.frame === 1 && state.sheets.open === 1 && state.sheets.top === 1, `sheets ${JSON.stringify(state.sheets)}`);
    expect(current_of(state) === "needle one", `the current match is ${current_of(state)}, expected needle one`);
    if (shot_dir) await take_shot(`${shot_dir}/find-matches.png`);
    const mark = events.length;
    await press_keys(...ENTER);
    await wait_event(mark, badge_is(page_id, "NORMAL"), "normal mode after Enter");
    const kept = await in_active_tab(READ_HIGHLIGHTS);
    expect(total_painted(kept) === 5, `Enter dropped the highlights: ${JSON.stringify(kept)}`);
  });

  await run_case("n and N step through the matches in order, across the frame and the roots, and wrap", async () => {
    const order = ["needle one", "needle two", "needle three", "needle four", "needle five"];
    const step_to = async (key, expected) => {
      await press_keys(key);
      await wait_highlights((read) => current_of(read) === expected, `${key} to make ${expected} the current match`);
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
    await press_keys("?needle");
    // Nothing lies above the top of the page, so the search wraps to the last match.
    await wait_highlights((read) => current_of(read) === "needle five", "the backward search wrapped to needle five");
    await press_enter_and_wait_for_close();
    await press_keys("n");
    await wait_highlights((read) => current_of(read) === "needle four", "n after ? to make needle four current");
    await press_keys("N");
    await wait_highlights((read) => current_of(read) === "needle five", "N after ? to make needle five current");
  });

  await run_case("Escape clears every highlight, in the frame and the roots too, and keeps the page where the match put it", async () => {
    const page_id = "find_escape";
    await open_page("find_page", page_id, { new_tab: true });
    await press_keys("/needle");
    await wait_highlights((read) => total_painted(read) === 5, "the matches");
    await press_keys(" five");
    await wait_highlights((read) => current_of(read) === "needle five", "the match far below");
    // A scroll is reported after it ends, so the first report past 500 is the final one.
    await poll_until("the page to report its scroll to the far match", () => last_scroll_y(page_id) > 500);
    const scrolled_to = last_scroll_y(page_id);
    const mark_escape = events.length;
    await press_keys(...ESCAPE);
    const state = await wait_highlights((read) => total_painted(read) === 0, "every highlight cleared");
    expect(Object.values(state.sheets).every((count) => count === 0), `a sheet was left behind: ${JSON.stringify(state.sheets)}`);
    await expect_absent(mark_escape, page_id, scroll_of(page_id), "the page scrolled back after Escape", { report_delay_ms: scroll_report_wait_ms });
    expect(last_scroll_y(page_id) === scrolled_to, `the page scrolled back to ${last_scroll_y(page_id)}`);
    // The query is kept as the last search, so n paints its one match again.
    await press_keys("n");
    await wait_highlights((read) => current_of(read) === "needle five" && total_painted(read) === 1, "n painting the kept search again");
  });

  await run_case("Escape in normal mode after Enter clears the highlights, and n brings them back from the same match", async () => {
    const page_id = "find_escape_normal";
    await open_page("find_page", page_id, { new_tab: true });
    await press_keys("/needle");
    await wait_highlights((read) => total_painted(read) === 5, "the matches");
    await press_enter_and_wait_for_close();
    await press_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "every highlight cleared");
    await press_keys("n");
    await wait_highlights((read) => current_of(read) === "needle two", "n from needle one onto needle two");
  });

  await run_case("Enter then / at once starts a new search that finds its matches", async () => {
    const page_id = "find_quick";
    await open_page("find_page", page_id, { new_tab: true });
    await type_search("/needle");
    await wait_highlights((read) => total_painted(read) === 5, "the matches");
    // Race: "/" and some of "four" reach the closing line's frame and come back over its port, the rest wait in the page.
    await press_keys(...ENTER, "/", "four");
    // A lost key leaves the line closed and empty. A product race leaves it open and holding four.
    await wait_highlights((read) => total_painted(read) === 1 && current_of(read) === "needle four", "the second search painting needle four").catch(async (error) => {
      throw new Error(`${error.message}, command line ${JSON.stringify(await read_cmdline_state())}`);
    });
    await press_keys(...ESCAPE);
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

  for (const page_id of ["find_scroll", "find_scroll_smooth"]) await run_case(`n and N bring each match fully into view: above, below, in a sideways scroller and in a frame (${page_id})`, async () => {
    await open_page("find_scroll", page_id, { new_tab: true });
    await press_keys("/marker");
    await wait_highlights((read) => current_of(read) !== "", "the first marker painted");
    await press_enter_and_wait_for_close();
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
    // The scroll may still be moving when the match changes, so the box is read until it sits inside the window.
    const step_and_check = async (key, step) => {
      await press_and_wait_for_new_current(key);
      let problem = "not read";
      await poll_until(`the match to sit fully in view after ${key} number ${step + 1}`, async () => !(problem = fully_visible(await in_active_tab(READ_CURRENT_BOXES))), { timeout_ms: 5000 }).catch(() => undefined);
      expect(!problem, `after ${key} number ${step + 1}: ${problem}`);
    };
    for (let step = 0; step < 8; step++) await step_and_check("n", step);
    for (let step = 0; step < 4; step++) await step_and_check("N", step);
  });

  await run_case("a match already visible in a short scrollable frame does not scroll the frame while the line is open or after Enter", async () => {
    const page_id = "find_frame_visible";
    await open_page("find_frame_visible", page_id, { new_tab: true });
    // The frame has no reporter, so a scroll listener in it records any scroll, and a read after the paint and after Enter finds it.
    await in_active_tab(`(() => { const frame = document.getElementById("frame").contentWindow; window.frame_scrolls = 0; frame.addEventListener("scroll", () => window.frame_scrolls++); return true; })()`);
    await press_keys("/marker");
    await wait_highlights((read) => total_painted(read) === 1, "the match in the frame");
    const frame_scroll = () => in_active_tab(`document.getElementById("frame").contentWindow.scrollY`);
    const frame_scroll_events = () => in_active_tab(`window.frame_scrolls`);
    expect((await frame_scroll()) === 0 && (await frame_scroll_events()) === 0, `the frame scrolled to ${await frame_scroll()} while typing`);
    await press_enter_and_wait_for_close();
    await barrier(page_id);
    expect((await frame_scroll()) === 0 && (await frame_scroll_events()) === 0, `the frame scrolled to ${await frame_scroll()} after Enter`);
  });

  const selection_is = (page_id, text) => (event) => event.type === "selection" && event.page_id === page_id && event.text === text;
  const select_in_page = (text) => in_active_tab(`window.find(${JSON.stringify(text)})`);

  await run_case("v and V start at the search match, and a later selection takes the place", async () => {
    const page_id = "find_start";
    await open_page("find_page", page_id, { new_tab: true });
    await press_keys("/four");
    await wait_highlights((read) => current_of(read) === "needle four", "the match in the closed root");
    await press_enter_and_wait_for_close();
    await press_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "every highlight cleared");
    const mark = events.length;
    await press_keys("v");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    await wait_event(mark, selection_is(page_id, "f"), "the caret on the match four");
    await escape_to_normal(page_id);
    const mark_visual = events.length;
    await press_keys("V");
    await wait_event(mark_visual, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark_visual, selection_is(page_id, "f"), "the selection on the match four");
    await escape_to_normal(page_id);
    // Something selected after the match wins: the word "one" on the first screen. Caret mode puts the caret on the release end of a selection, the "e".
    const mark_select = events.length;
    await select_in_page("one");
    await wait_event(mark_select, selection_is(page_id, "one"), "the page to report the selected word");
    const mark_later = events.length;
    await press_keys("v");
    await wait_event(mark_later, selection_is(page_id, "e"), "the caret on the end of the later selection, not on the match");
    await escape_to_normal(page_id);
  });

  await run_case("a frame and a root that leave the page mid-search do not break it, while typing or on n", async () => {
    const page_id = "find_gone";
    await open_page("find_page", page_id, { new_tab: true });
    await press_keys("/needl");
    await wait_highlights((read) => total_painted(read) === 5, "the first matches");
    await in_active_tab(`document.getElementById("frame").remove(); document.getElementById("open_host").remove();`);
    await press_keys("e");
    // one, four and five are left, and the frame's highlight is gone with its document.
    const state = await wait_highlights((read) => read.top_all.length + read.top_current.length === 3, "three matches after the frame and the open root left");
    expect(current_of(state) === "needle one", `the current match is ${current_of(state)}`);
    await press_enter_and_wait_for_close();
    await press_keys("n");
    const after_n = await wait_highlights((read) => current_of(read) === "needle four", "n onto needle four");
    expect(after_n.top_all.length + after_n.top_current.length === 3, `painted ${JSON.stringify(after_n)}`);
  });

  await run_case("a slow scan for an old query never paints over the newer query", async () => {
    const page_id = "find_race";
    await open_page("find_big", page_id, { new_tab: true });
    // "e" has hundreds of thousands of matches and takes many slices. "ex" arrives while it scans.
    await press_keys("/ex");
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
    // These two waits stay fixed: the case is about what the old scan does in the seconds after the new query, and the page reports neither the scan's end nor a late paint.
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
    await press_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
  });

  await run_case("a pattern that would backtrack without end is not run, and the tab keeps answering", async () => {
    const page_id = "find_costly";
    await open_page("find_page", page_id, { new_tab: true });
    // 40 letters and then a character that fails the pattern: (a+)+$ takes about 2^40 steps if it runs as a regex.
    await in_active_tab(`document.body.textContent = ${JSON.stringify("a".repeat(40) + "!")}; true`);
    // An Escape that reaches the line before it is ready is dropped, so the pattern must be in the line first.
    await press_keys("/");
    await type_in_line("(a+)+$");
    // A frozen tab never answers, so the read races a time limit.
    const answered = await Promise.race([in_active_tab("document.title").then(() => true), sleep(5000).then(() => false)]);
    expect(answered, "the tab did not answer within 5 seconds of a costly pattern");
    const mark = events.length;
    await press_keys(...ESCAPE);
    await wait_event(mark, badge_is(page_id, "NORMAL"), "normal mode after Escape");
  });

  // The toast text sits in a closed shadow root. The extension's own world reads it with openOrClosedShadowRoot.
  const READ_TOAST = `(() => {
    const host = [...document.documentElement.children].find((child) => child.style.zIndex === "2147483645");
    return host ? host.openOrClosedShadowRoot.querySelector(".desertfox-toast")?.textContent ?? "" : "";
  })()`;
  async function wait_toast(pattern, what) {
    const seen = new Set();
    let found;
    try {
      await poll_until(what, async () => {
        const text = await in_active_tab(READ_TOAST);
        if (text) seen.add(text);
        if (pattern.test(text)) found = text;
        return found !== undefined;
      }, { timeout_ms: 5000 });
    } catch (error) {
      throw new Error(`${error.message}, the toasts seen were ${JSON.stringify([...seen])}`);
    }
    return found;
  }
  // The 300 ms limit in find_scan.ts also counts the Worker start and the copy of the page text into it. This measures both on a page at the 4 million character cap.
  await run_case("the find worker starts and takes a 4 million character text well inside the time limit", async () => {
    const timings = await evaluate_in_background(rdp, extension_id, `(async () => {
      const answer_ms = (text) => new Promise((resolve, reject) => {
        const started = performance.now();
        const worker = new Worker(browser.runtime.getURL("find_worker.js"));
        worker.onmessage = () => { worker.terminate(); resolve(performance.now() - started); };
        worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
        // A sticky regex tries one place only, so the time is the start and the copy, not the scan.
        worker.postMessage({ text, source: "b", flags: "gy" });
      });
      const large = "word ".repeat(800000);
      const median = (runs) => runs.sort((left, right) => left - right)[runs.length >> 1];
      const small_runs = [];
      const large_runs = [];
      for (let run = 0; run < 7; run++) {
        small_runs.push(await answer_ms("x"));
        large_runs.push(await answer_ms(large));
      }
      return { chars: large.length, small_ms: median(small_runs), large_ms: median(large_runs), large_max_ms: Math.max(...large_runs) };
    })()`);
    console.log(`find worker timings ${JSON.stringify(timings)}`);
    expect(timings?.chars === 4000000 && timings.large_ms < 300, `timings ${JSON.stringify(timings)}`);
  });

  await run_case("a regex past the time limit is stopped, Enter searches it as text, and the next search works", async () => {
    const page_id = "find_timeout";
    await open_page("find_page", page_id, { new_tab: true });
    // No match as a regex, and seconds of backtracking over the run of "a" without the limit. As text it finds its own characters at the end.
    await in_active_tab(`document.body.textContent = ${JSON.stringify("a".repeat(60000) + " a.*b.*c(?=Q)")}; true`);
    const started = Date.now();
    await press_keys("/");
    await type_in_line("a.*b.*c(?=Q)");
    const answered = await Promise.race([in_active_tab("document.title").then(() => true), sleep(5000).then(() => false)]);
    expect(answered, "the tab did not answer within 5 seconds of a slow regex");
    let mark = events.length;
    await press_keys(...ENTER);
    await wait_event(mark, badge_is(page_id, "NORMAL"), "normal mode after Enter");
    await wait_highlights((read) => total_painted(read) === 1, "the pattern found as text");
    expect(Date.now() - started < 15000, `the search took ${Date.now() - started} ms`);
    await press_keys("n");
    await wait_toast(/^1 of 1, wrapped \(too slow as a regex, searched as text\)$/, "the toast with the text fallback note");
    await press_keys("/a{3}");
    await wait_cmdline((line) => line.open && line.value === "a{3}", "the search line to hold a{3}");
    mark = events.length;
    await press_keys(...ENTER);
    await wait_event(mark, badge_is(page_id, "NORMAL"), "normal mode after the second Enter");
    await press_keys("n");
    await wait_toast(/ of 20000$/, "the toast of the regex search after the timeout");
    await press_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
  });

  const READ_SELECTION = `(() => { const s = getSelection(); return { text: String(s), anchor: s.anchorNode?.data?.slice(0, 20), anchor_offset: s.anchorOffset, focus: s.focusNode?.data?.slice(0, 20), focus_offset: s.focusOffset }; })()`;
  const mode_badge = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  // Polls the page selection until it passes `predicate`, so the case reads it after the caret has moved and not on a timer.
  const wait_read = (predicate, what) => poll_reads(() => in_active_tab(READ_SELECTION), predicate, what);

  await run_case("visual /foo then Enter grows the selection to the match and keeps the anchor, and Escape on the line leaves selection and mode as they were", async () => {
    const page_id = "find_vis_enter";
    await open_page("caret", page_id, { new_tab: true });
    let mark = events.length;
    await press_keys("V");
    await wait_event(mark, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is(page_id, "c"), "the selection on the first character");
    const before = await in_active_tab(READ_SELECTION);
    // Escape first: the line closes, the selection and the mode stay.
    await type_search("/foo");
    await press_keys(...ESCAPE);
    await wait_cmdline((line) => !line.open, "the search line to close after Escape");
    await poll_until("the VISUAL badge to return after Escape", () => mode_badge(page_id) === "VISUAL");
    await barrier(page_id);
    const after_escape = await in_active_tab(READ_SELECTION);
    expect(JSON.stringify(after_escape) === JSON.stringify(before), `Escape changed the selection from ${JSON.stringify(before)} to ${JSON.stringify(after_escape)}`);
    // Enter: the caret end goes to the match, the anchor stays.
    await type_search("/foo");
    mark = events.length;
    await press_enter_and_wait_for_close();
    await wait_event(mark, (event) => is_selection_of(page_id)(event) && event.text.startsWith("caret ") && event.text.endsWith("f"), "the selection to grow to the match foo");
    await poll_until("the VISUAL badge to return after Enter", () => mode_badge(page_id) === "VISUAL");
    const grown = await in_active_tab(READ_SELECTION);
    expect(grown.anchor === before.anchor && grown.anchor_offset === before.anchor_offset, `the anchor moved: ${JSON.stringify(before)} then ${JSON.stringify(grown)}`);
    expect(grown.focus?.startsWith("foo bar") && grown.focus_offset <= 1, `the selection does not end on the match foo: ${JSON.stringify(grown)}`);
    expect(grown.text.startsWith("caret ") && grown.text.endsWith("f"), `the selected text is ${JSON.stringify(grown.text)}`);
    await escape_to_normal(page_id);
  });

  await run_case("* and # in normal mode toast N of M and paint the match, and in caret mode the caret moves to the match", async () => {
    const page_id = "find_star";
    await open_page("find_words", page_id, { new_tab: true });
    // With no caret, the word is the first one on the page, the h1 title "find_words". It is on the page four times.
    await press_keys("*");
    await wait_toast(/^2 of 4$/, "the toast for *");
    let state = await wait_highlights((read) => current_of(read) === "find_words aa", "* painting the next match");
    expect(total_painted(state) === 4, `${total_painted(state)} ranges painted, expected 4`);
    await press_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
    await press_keys("#");
    // After * and Escape the page position is the match aa, so # goes back one match to the title.
    await wait_toast(/^1 of 4$/, "the toast for #");
    await wait_highlights((read) => current_of(read).startsWith("find_words find_star"), "# painting the match before aa, the title");
    await press_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    await wait_event(mark, selection_is(page_id, "f"), "the caret on the h1 title");
    await press_keys("*");
    await wait_toast(/^2 of 4$/, "the toast for * in caret mode");
    await wait_read((read) => read.anchor === "find_words aa" && read.anchor_offset === 0, "the caret on the match aa");
    expect(mode_badge(page_id) === "CARET", `the badge is ${mode_badge(page_id)}, expected CARET`);
    await press_keys(...ESCAPE);
  });

  await run_case("* with a visual selection searches the selected text, not the word", async () => {
    const page_id = "find_star_visual";
    await open_page("find_words", page_id, { new_tab: true });
    await select_in_page("quick fox");
    await in_active_tab(`(() => { const s = getSelection(); s.collapseToStart(); return true; })()`);
    let mark = events.length;
    await press_keys("V");
    await wait_event(mark, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is(page_id, "q"), "the selection on the q of quick");
    await press_keys("e");
    await wait_event(mark, selection_is(page_id, "quick"), "the selection of the word quick");
    // As a word, quick is on the page twice. As text it is three times, with quickly.
    await press_keys("*");
    await wait_toast(/^2 of 3$/, "the toast for * on the selection");
    await wait_highlights((read) => current_of(read) === "quickly now", "the match in quickly");
  });

  await run_case("n finds a match that a page script added after the search", async () => {
    const page_id = "find_watch";
    await open_page("find_words", page_id, { new_tab: true });
    await press_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await press_enter_and_wait_for_close();
    await in_active_tab(`const added = document.createElement("p"); added.textContent = "find_words added"; document.body.append(added); true`);
    let reached = false;
    for (let press = 0; press < 5 && !reached; press++) {
      reached = current_of(await press_and_wait_for_new_current("n")) === "find_words added";
    }
    expect(reached, "five presses of n never reached the added match");
    expect(/of 5/.test(await wait_toast(/of 5/, "the toast with five matches")), "the toast does not count five matches");
  });

  await run_case("opening and closing the command line does not make the model stale, and a page change does", async () => {
    const page_id = "find_stale";
    await open_page("find_words", page_id, { new_tab: true });
    await press_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await press_enter_and_wait_for_close();
    // The model walk reads each element's style. The count is kept on the extension's window.
    await in_active_tab(`window.style_reads = 0; if (!window.style_reads_hooked) { window.style_reads_hooked = true; const original = window.getComputedStyle; window.getComputedStyle = function (...args) { window.style_reads++; return original.apply(window, args); }; } true`);
    await press_keys(":");
    // The completion list is open, so the first Escape closes it and the second closes the line.
    await wait_cmdline((line) => line.open && line.list_open, "the command line to open with its list");
    await close_cmdline();
    await press_and_wait_for_new_current("n");
    await wait_highlights((read) => current_of(read) === "find_words aa", "n onto the next match");
    const reads_after_line = await in_active_tab("window.style_reads");
    // Control: the probe sees a walk when the page changes.
    await in_active_tab(`document.body.append(document.createElement("p")); true`);
    await press_keys("n");
    await poll_until("the probe to count a model walk after the page change", async () => (await in_active_tab("window.style_reads")) > 0);
    const reads_after_change = await in_active_tab("window.style_reads");
    expect(reads_after_change > 0, "the probe never counted a model walk, so it proves nothing");
    expect(reads_after_line === 0, `the model was read again after the command line (${reads_after_line} style reads)`);
  });

  await run_case("a page over 4000000 characters gives the cut note", async () => {
    const page_id = "find_huge_cut";
    await open_page("find_huge", page_id, { new_tab: true });
    await press_keys("/needle");
    await wait_highlights((read) => total_painted(read) === 1, "the single match on the long page", 15000);
    await press_enter_and_wait_for_close();
    await press_keys("n");
    const note = await wait_toast(/long page: only the first 4 million characters are searched/, "the cut note");
    expect(/^1 of 1/.test(note), `the toast reads "${note}"`);
  });

  // The page /find_words has "find_words" in the h1 title and in the paragraphs aa, bb and cc, in that order.
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];
  const collapse_at = async (text) => {
    await select_in_page(text);
    await in_active_tab(`(() => { const s = getSelection(); s.collapse(s.anchorNode, 0); return true; })()`);
  };
  const start_visual = async (page_id) => {
    const mark = events.length;
    await press_keys("V");
    await wait_event(mark, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is(page_id, "f"), "the selection on the f of find_words");
  };
  // A visual search from the title: the text goes into the line, and Enter moves the caret end to the match.
  const search_in_visual = async (typed) => {
    await type_search(typed);
    await press_enter_and_wait_for_close();
  };
  const on_match = (name) => (read) => read.focus === `find_words ${name}` && read.focus_offset <= 1;

  await run_case("visual n and N move the caret end between matches, keep the anchor and select the match's first character", async () => {
    const page_id = "find_vis_nN";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    const anchor_before = await in_active_tab(READ_SELECTION);
    await search_in_visual("/find_words");
    let state = await wait_read(on_match("aa"), "Enter to put the caret end on aa");
    await press_keys("n");
    state = await wait_read(on_match("bb"), "n to put the caret end on bb");
    expect(state.anchor === anchor_before.anchor && state.anchor_offset === anchor_before.anchor_offset, `n moved the anchor: ${JSON.stringify(state)}`);
    expect(state.text.endsWith("f") && state.text.includes("find_words aa"), `the selected text is ${JSON.stringify(state.text)}`);
    expect(mode_badge(page_id) === "VISUAL", `the badge is ${mode_badge(page_id)}`);
    await press_keys("N");
    state = await wait_read((read) => on_match("aa")(read) && read.anchor === anchor_before.anchor, "N to put the caret end back on aa");
    expect(!state.text.includes("find_words bb"), `N left the selection at ${JSON.stringify(state.text)}`);
  });

  await run_case("visual N with the anchor after the match flips the selection and includes the match's first character, and n wraps with the selection following", async () => {
    const page_id = "find_vis_flip";
    await open_page("find_words", page_id, { new_tab: true });
    await collapse_at("find_words cc");
    await start_visual(page_id);
    await search_in_visual("?find_words");
    // The page selection is always in document order, so a flipped selection reads by its text: the match first, the anchor's first character last.
    await wait_read((read) => read.text === "find_words bb\n\nf", "? Enter to select from bb to the anchor");
    await press_keys("n");
    await wait_read((read) => read.text.startsWith("find_words aa") && read.text.endsWith("f") && read.text.includes("find_words bb"), "n to wrap back to aa");
    await press_keys("N");
    await wait_read((read) => read.text === "find_words bb\n\nf", "N to select from bb to the anchor again");
  });

  await run_case("visual n at the last match wraps to the first, and the selection follows", async () => {
    const page_id = "find_vis_wrap";
    await open_page("find_words", page_id, { new_tab: true });
    await collapse_at("find_words bb");
    await start_visual(page_id);
    await search_in_visual("/find_words");
    await wait_read((read) => read.focus === "find_words cc", "Enter to put the caret end on cc");
    await press_keys("n");
    // From the title to the first character of bb, where the anchor is.
    await wait_read((read) => read.text.startsWith("find_words find_vis_wrap") && read.text.endsWith("find_words aa\n\nf") && !read.text.includes("cc"), "n to wrap from cc to the title");
  });

  await run_case("visual y after n copies the text up to and including the match's first character", async () => {
    const page_id = "find_vis_yank";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await search_in_visual("/find_words");
    await wait_read(on_match("aa"), "Enter to put the caret end on aa");
    await press_keys("n");
    const expected = (await wait_read(on_match("bb"), "n to put the caret end on bb")).text.replace(/\s+/g, " ").trim();
    expect(expected.endsWith("find_words aa f"), `the selection is ${JSON.stringify(expected)}`);
    // The page reports a toast only when one appears, and the toast of n may still be up, so the text is read.
    await press_keys("y");
    await wait_toast(/^Copied /, "the copied toast");
    await escape_to_normal(page_id);
    const mark = events.length;
    await press_keys("gi");
    await wait_event(mark, badge_is(page_id, "INSERT"), "the INSERT badge after gi");
    await press_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === page_id, "the pasted text");
    expect(pasted.value.replace(/\s+/g, " ").trim() === expected, `y copied ${JSON.stringify(pasted.value)}, expected ${JSON.stringify(expected)}`);
  });

  await run_case("n in normal mode still steps without a selection", async () => {
    const page_id = "find_normal_n";
    await open_page("find_words", page_id, { new_tab: true });
    await press_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await press_enter_and_wait_for_close();
    await press_and_wait_for_new_current("n");
    await wait_highlights((read) => current_of(read) === "find_words bb" || current_of(read) === "find_words aa", "n stepping");
    expect(mode_badge(page_id) === "NORMAL", `the badge is ${mode_badge(page_id)}, expected NORMAL`);
    expect((await in_active_tab(READ_SELECTION)).text === "", "n in normal mode made a selection");
  });

  await run_case("* on a one-character visual selection finds every occurrence of that character", async () => {
    const page_id = "find_star_char";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    // The character f is on the page six times: the title twice (find and find_star_char), the three paragraphs aa to cc, and fox.
    await press_keys("*");
    await wait_toast(/^2 of 6$/, "the toast for * on one character");
  });

  await run_case("* on a lowercase visual selection skips a capitalised match", async () => {
    const page_id = "find_star_case";
    await open_page("find_case", page_id, { new_tab: true });
    await collapse_at("zeta one");
    const mark = events.length;
    await press_keys("V");
    await wait_event(mark, selection_is(page_id, "z"), "the selection on the z");
    await press_keys("e");
    await wait_event(mark, selection_is(page_id, "zeta"), "the selection of zeta");
    await press_keys("*");
    await wait_toast(/^2 of 2$/, "two matches, not three");
    await wait_highlights((read) => current_of(read) === "zeta three", "the match past Zeta");
    // n goes on past Zeta too: the next match wraps to the first lowercase one.
    await press_keys("n");
    await wait_highlights((read) => current_of(read) === "zeta one", "n skipping Zeta on the way round");
  });

  await run_case("* on a word that starts with a surrogate-pair letter takes the whole word", async () => {
    const page_id = "find_star_astral";
    await open_page("find_astral", page_id, { new_tab: true });
    // The caret goes to the first letter of the word, after "x " in the first paragraph.
    await in_active_tab(`(() => { const text = document.querySelector("p").firstChild; getSelection().collapse(text, 2); return true; })()`);
    const mark = events.length;
    await press_keys("v");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    const before_star = await in_active_tab(READ_SELECTION);
    await press_keys("*");
    await wait_toast(/^2 of 2$/, `the whole word matched twice (the caret was at ${JSON.stringify(before_star)})`);
    await wait_highlights((read) => current_of(read).startsWith("\u{1D49C}bc again"), "the match in the second paragraph");
  });

  await run_case("visual n steps from the caret after j moved it past matches, and not back to the last match", async () => {
    const page_id = "find_vis_caret";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await search_in_visual("/find_words");
    let state = await wait_read((read) => read.focus === "find_words aa", "Enter to put the caret end on aa");
    for (const key of ["j", "j", "l"]) await press_and_wait_for_move(page_id, key, `${key} to move the caret`);
    state = await in_active_tab(READ_SELECTION);
    expect(state.focus === "find_words cc", `after j j l ${JSON.stringify(state)}`);
    await press_keys("n");
    await wait_read((read) => read.focus?.startsWith("find_words find_vis_") && read.focus_offset <= 1, "n to wrap to the title and not back to bb");
  });

  await run_case("visual N onto a match before the anchor flips the selection", async () => {
    const page_id = "find_vis_before";
    await open_page("find_words", page_id, { new_tab: true });
    await collapse_at("find_words bb");
    await start_visual(page_id);
    await search_in_visual("/find_words");
    await wait_read((read) => read.anchor === "find_words bb" && read.focus === "find_words cc", "Enter to select from the anchor on bb to cc");
    await press_keys("N");
    await wait_read((read) => read.focus === "find_words bb", "N onto the anchor's own match");
    await press_keys("N");
    await wait_read((read) => read.text === "find_words aa\n\nf", "N before the anchor to select aa up to the anchor");
  });

  await run_case("a click in visual mode keeps the anchor, takes the caret end, and n then steps from there", async () => {
    const page_id = "find_vis_click";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await search_in_visual("/find_words");
    await wait_read(on_match("aa"), "Enter to put the caret end on aa");
    // A click collapses the page selection onto the clicked text. The session takes it at the next key, so the wait is for the page's own report of the collapse.
    const mark_click = events.length;
    await in_active_tab(`(() => { const text = [...document.querySelectorAll("p")].find((p) => p.textContent === "find_words bb").firstChild; getSelection().collapse(text, 0); return true; })()`);
    await wait_event(mark_click, (event) => is_selection_of(page_id)(event) && event.text === "", "the page to report the collapsed selection");
    // Visual mode keeps its anchor on a click and takes the clicked text as the caret end, so n goes on from bb to cc.
    await press_keys("n");
    await wait_read((read) => read.anchor === "find_words find_vis_" && read.focus === "find_words cc", "n to go from the click on bb to cc with the anchor on the title");
  });

  await run_case("a fresh visual session after an earlier search: n goes to the first match after the caret", async () => {
    const page_id = "find_vis_fresh";
    await open_page("find_words", page_id, { new_tab: true });
    await press_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await press_enter_and_wait_for_close();
    await press_and_wait_for_new_current("n");
    await press_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
    await start_visual(page_id);
    await press_keys("n");
    // V starts at the search match aa, so the first match after the caret is bb.
    await wait_read((read) => read.text === "find_words aa\n\nf", "n from the new caret to go from aa to bb");
  });

  await run_case("visual / after a click searches from the clicked text, not from the caret the session held before", async () => {
    const page_id = "find_vis_open_click";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await in_active_tab(`(() => { const text = [...document.querySelectorAll("p")].find((p) => p.textContent === "find_words cc").firstChild; getSelection().collapse(text, 1); return true; })()`);
    await wait_read((read) => read.focus === "find_words cc", "visual mode to take the click as the caret end");
    await search_in_visual("/find_words");
    // The caret is one character into cc, so the next match wraps to the title. From the stale caret on the title it would be aa.
    await wait_read((read) => read.focus?.startsWith("find_words find_vis_") && read.focus_offset <= 1, "the search to wrap to the title");
  });

  await run_case("visual j after a search lands moves from the column of the match, not from the column of an earlier j", async () => {
    const page_id = "find_vis_goal";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await press_keys("l", "l", "l", "l", "l", "l", "l", "l");
    await wait_read((read) => read.focus_offset === 9, "eight l to move the caret end to column 9");
    await press_and_wait_for_move(page_id, "j", "j to the next paragraph");
    await search_in_visual("/find_words");
    await wait_read((read) => read.focus?.startsWith("find_words") && read.focus_offset <= 1, "Enter to put the caret end on a match");
    await press_and_wait_for_move(page_id, "j", "j to the next paragraph from the match");
    const state = await in_active_tab(READ_SELECTION);
    expect(state.focus?.startsWith("find_words") && state.focus_offset <= 1, `j went to column ${state.focus_offset} of ${JSON.stringify(state.focus)}, expected the match column`);
  });
}
