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

  for (const page_id of ["find_scroll", "find_scroll_smooth"]) await run_case(`n and N bring each match fully into view: above, below, in a sideways scroller and in a frame (${page_id})`, async () => {
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
      await send_keys("n");
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

  await run_case("a match already visible in a short scrollable frame does not scroll the frame while the line is open or after Enter", async () => {
    await open_page("find_frame_visible", "find_frame_visible", { new_tab: true });
    await send_keys("/marker");
    await wait_highlights((read) => total_painted(read) === 1, "the match in the frame");
    await sleep(600);
    const frame_scroll = () => in_active_tab(`document.getElementById("frame").contentWindow.scrollY`);
    expect((await frame_scroll()) === 0, `the frame scrolled to ${await frame_scroll()} while typing`);
    await send_keys(...ENTER);
    await sleep(500);
    expect((await frame_scroll()) === 0, `the frame scrolled to ${await frame_scroll()} after Enter`);
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

  await run_case("a pattern that would backtrack without end is not run, and the tab keeps answering", async () => {
    const page_id = "find_costly";
    await open_page("find_page", page_id, { new_tab: true });
    // 40 letters and then a character that fails the pattern: (a+)+$ takes about 2^40 steps if it runs as a regex.
    await in_active_tab(`document.body.textContent = ${JSON.stringify("a".repeat(40) + "!")}; true`);
    await send_keys("/(a+)+$");
    // A frozen tab never answers, so the read races a time limit.
    const answered = await Promise.race([in_active_tab("document.title").then(() => true), sleep(5000).then(() => false)]);
    expect(answered, "the tab did not answer within 5 seconds of a costly pattern");
    const mark = events.length;
    await send_keys(...ESCAPE);
    await wait_event(mark, badge_is(page_id, "NORMAL"), "normal mode after Escape");
  });

  // The toast text sits in a closed shadow root. The extension's own world reads it with openOrClosedShadowRoot.
  const READ_TOAST = `(() => {
    const host = [...document.documentElement.children].find((child) => child.style.zIndex === "2147483645");
    return host ? host.openOrClosedShadowRoot.querySelector(".oasisfox-toast")?.textContent ?? "" : "";
  })()`;
  async function wait_toast(pattern, what) {
    const seen = new Set();
    for (let attempt = 0; attempt < 40; attempt++) {
      const text = await in_active_tab(READ_TOAST);
      if (pattern.test(text)) return text;
      if (text) seen.add(text);
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}, the toasts seen were ${JSON.stringify([...seen])}`);
  }
  const READ_SELECTION = `(() => { const s = getSelection(); return { text: String(s), anchor: s.anchorNode?.data?.slice(0, 20), anchor_offset: s.anchorOffset, focus: s.focusNode?.data?.slice(0, 20), focus_offset: s.focusOffset }; })()`;
  const mode_badge = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;

  await run_case("visual /foo then Enter grows the selection to the match and keeps the anchor, and Escape on the line leaves selection and mode as they were", async () => {
    const page_id = "find_vis_enter";
    await open_page("caret", page_id, { new_tab: true });
    let mark = events.length;
    await send_keys("V");
    await wait_event(mark, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is(page_id, "c"), "the selection on the first character");
    const before = await in_active_tab(READ_SELECTION);
    // Escape first: the line closes, the selection and the mode stay.
    await send_keys("/foo");
    await sleep(400);
    await send_keys(...ESCAPE);
    await sleep(500);
    const after_escape = await in_active_tab(READ_SELECTION);
    expect(JSON.stringify(after_escape) === JSON.stringify(before), `Escape changed the selection from ${JSON.stringify(before)} to ${JSON.stringify(after_escape)}`);
    expect(mode_badge(page_id) === "VISUAL", `the badge after Escape is ${mode_badge(page_id)}, expected VISUAL`);
    // Enter: the caret end goes to the match, the anchor stays.
    await send_keys("/foo");
    await sleep(400);
    mark = events.length;
    await send_keys(...ENTER);
    await sleep(600);
    expect(mode_badge(page_id) === "VISUAL", `the badge after Enter is ${mode_badge(page_id)}, expected VISUAL`);
    const grown = await in_active_tab(READ_SELECTION);
    expect(grown.anchor === before.anchor && grown.anchor_offset === before.anchor_offset, `the anchor moved: ${JSON.stringify(before)} then ${JSON.stringify(grown)}`);
    expect(grown.focus?.startsWith("foo bar") && grown.focus_offset <= 1, `the selection does not end on the match foo: ${JSON.stringify(grown)}`);
    expect(grown.text.startsWith("caret ") && grown.text.endsWith("f"), `the selected text is ${JSON.stringify(grown.text)}`);
    await send_keys(...ESCAPE);
    await send_keys(...ESCAPE);
  });

  await run_case("* and # in normal mode toast N of M and paint the match, and in caret mode the caret moves to the match", async () => {
    const page_id = "find_star";
    await open_page("find_words", page_id, { new_tab: true });
    // With no caret, the word is the first one on the page, the h1 title "find_words". It is on the page four times.
    await send_keys("*");
    await wait_toast(/^2 of 4$/, "the toast for *");
    let state = await wait_highlights((read) => current_of(read) === "find_words aa", "* painting the next match");
    expect(total_painted(state) === 4, `${total_painted(state)} ranges painted, expected 4`);
    await send_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
    await send_keys("#");
    // After * and Escape the page position is the match aa, so # goes back one match to the title.
    await wait_toast(/^1 of 4$/, "the toast for #");
    await wait_highlights((read) => current_of(read).startsWith("find_words find_star"), "# painting the match before aa, the title");
    await send_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
    const mark = events.length;
    await send_keys("gV");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    await wait_event(mark, selection_is(page_id, "f"), "the caret on the h1 title");
    await send_keys("*");
    await wait_toast(/^2 of 4$/, "the toast for * in caret mode");
    await sleep(300);
    const caret = await in_active_tab(READ_SELECTION);
    expect(caret.anchor === "find_words aa" && caret.anchor_offset === 0, `the caret is not on the match: ${JSON.stringify(caret)}`);
    expect(mode_badge(page_id) === "CARET", `the badge is ${mode_badge(page_id)}, expected CARET`);
    await send_keys(...ESCAPE);
  });

  await run_case("* with a visual selection searches the selected text, not the word", async () => {
    const page_id = "find_star_visual";
    await open_page("find_words", page_id, { new_tab: true });
    await select_in_page("quick fox");
    await in_active_tab(`(() => { const s = getSelection(); s.collapseToStart(); return true; })()`);
    await sleep(300);
    let mark = events.length;
    await send_keys("V");
    await wait_event(mark, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is(page_id, "q"), "the selection on the q of quick");
    await send_keys("e");
    await wait_event(mark, selection_is(page_id, "quick"), "the selection of the word quick");
    // As a word, quick is on the page twice. As text it is three times, with quickly.
    await send_keys("*");
    await wait_toast(/^2 of 3$/, "the toast for * on the selection");
    await wait_highlights((read) => current_of(read) === "quickly now", "the match in quickly");
  });

  await run_case("n finds a match that a page script added after the search", async () => {
    const page_id = "find_watch";
    await open_page("find_words", page_id, { new_tab: true });
    await send_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await send_keys(...ENTER);
    await sleep(300);
    await in_active_tab(`const added = document.createElement("p"); added.textContent = "find_words added"; document.body.append(added); true`);
    await sleep(300);
    let reached = false;
    for (let press = 0; press < 5 && !reached; press++) {
      await send_keys("n");
      await sleep(400);
      reached = current_of(await in_active_tab(READ_HIGHLIGHTS)) === "find_words added";
    }
    expect(reached, "five presses of n never reached the added match");
    expect(/of 5/.test(await wait_toast(/of 5/, "the toast with five matches")), "the toast does not count five matches");
  });

  await run_case("opening and closing the command line does not make the model stale, and a page change does", async () => {
    const page_id = "find_stale";
    await open_page("find_words", page_id, { new_tab: true });
    await send_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await send_keys(...ENTER);
    await sleep(400);
    // The model walk reads each element's style. The count is kept on the extension's window.
    await in_active_tab(`window.style_reads = 0; if (!window.style_reads_hooked) { window.style_reads_hooked = true; const original = window.getComputedStyle; window.getComputedStyle = function (...args) { window.style_reads++; return original.apply(window, args); }; } true`);
    await send_keys(":");
    await sleep(600);
    // The completion list is open, so the first Escape closes it and the second closes the line.
    await send_keys(...ESCAPE);
    await send_keys(...ESCAPE);
    await sleep(500);
    await send_keys("n");
    await wait_highlights((read) => current_of(read) === "find_words aa", "n onto the next match");
    const reads_after_line = await in_active_tab("window.style_reads");
    // Control: the probe sees a walk when the page changes.
    await in_active_tab(`document.body.append(document.createElement("p")); true`);
    await sleep(300);
    await send_keys("n");
    await sleep(600);
    const reads_after_change = await in_active_tab("window.style_reads");
    expect(reads_after_change > 0, "the probe never counted a model walk, so it proves nothing");
    expect(reads_after_line === 0, `the model was read again after the command line (${reads_after_line} style reads)`);
  });

  await run_case("a page over 4000000 characters gives the cut note", async () => {
    const page_id = "find_huge_cut";
    await open_page("find_huge", page_id, { new_tab: true });
    await send_keys("/needle");
    await sleep(1000);
    await send_keys(...ENTER);
    await sleep(500);
    await send_keys("n");
    const note = await wait_toast(/long page: only the first 4 million characters are searched/, "the cut note");
    expect(/^1 of 1/.test(note), `the toast reads "${note}"`);
  });

  // The page /find_words has "find_words" in the h1 title and in the paragraphs aa, bb and cc, in that order.
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];
  const collapse_at = async (text) => {
    await select_in_page(text);
    await in_active_tab(`(() => { const s = getSelection(); s.collapse(s.anchorNode, 0); return true; })()`);
    await sleep(300);
  };
  const start_visual = async (page_id) => {
    const mark = events.length;
    await send_keys("V");
    await wait_event(mark, badge_is(page_id, "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is(page_id, "f"), "the selection on the f of find_words");
  };
  const read_after = async (what) => {
    await sleep(600);
    const read = await in_active_tab(READ_SELECTION);
    return { ...read, what };
  };

  await run_case("visual n and N move the caret end between matches, keep the anchor and select the match's first character", async () => {
    const page_id = "find_vis_nN";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    const anchor_before = await in_active_tab(READ_SELECTION);
    await send_keys("/find_words");
    await sleep(400);
    await send_keys(...ENTER);
    let state = await read_after("Enter");
    expect(state.focus === "find_words aa" && state.focus_offset <= 1, `after Enter ${JSON.stringify(state)}`);
    await send_keys("n");
    state = await read_after("n");
    expect(state.focus === "find_words bb" && state.focus_offset <= 1, `after n ${JSON.stringify(state)}`);
    expect(state.anchor === anchor_before.anchor && state.anchor_offset === anchor_before.anchor_offset, `n moved the anchor: ${JSON.stringify(state)}`);
    expect(state.text.endsWith("f") && state.text.includes("find_words aa"), `the selected text is ${JSON.stringify(state.text)}`);
    expect(mode_badge(page_id) === "VISUAL", `the badge is ${mode_badge(page_id)}`);
    await send_keys("N");
    state = await read_after("N");
    expect(state.focus === "find_words aa" && state.focus_offset <= 1 && state.anchor === anchor_before.anchor, `after N ${JSON.stringify(state)}`);
    expect(!state.text.includes("find_words bb"), `N left the selection at ${JSON.stringify(state.text)}`);
  });

  await run_case("visual N with the anchor after the match flips the selection and includes the match's first character, and n wraps with the selection following", async () => {
    const page_id = "find_vis_flip";
    await open_page("find_words", page_id, { new_tab: true });
    await collapse_at("find_words cc");
    await start_visual(page_id);
    await send_keys("?find_words");
    await sleep(400);
    await send_keys(...ENTER);
    let state = await read_after("? Enter");
    // The page selection is always in document order, so a flipped selection reads by its text: the match first, the anchor's first character last.
    expect(state.text === "find_words bb\n\nf", `after ? ${JSON.stringify(state)}`);
    await send_keys("n");
    state = await read_after("n backward");
    expect(state.text.startsWith("find_words aa") && state.text.endsWith("f") && state.text.includes("find_words bb"), `after n ${JSON.stringify(state)}`);
    await send_keys("N");
    state = await read_after("N");
    expect(state.text === "find_words bb\n\nf", `after N ${JSON.stringify(state)}`);
    expect(state.text.startsWith("find_words bb"), `the selected text is ${JSON.stringify(state.text)}`);
  });

  await run_case("visual n at the last match wraps to the first, and the selection follows", async () => {
    const page_id = "find_vis_wrap";
    await open_page("find_words", page_id, { new_tab: true });
    await collapse_at("find_words bb");
    await start_visual(page_id);
    await send_keys("/find_words");
    await sleep(400);
    await send_keys(...ENTER);
    let state = await read_after("Enter");
    expect(state.focus === "find_words cc", `after Enter ${JSON.stringify(state)}`);
    await send_keys("n");
    state = await read_after("n wrapped");
    // From the title to the first character of bb, where the anchor is.
    expect(state.text.startsWith("find_words find_vis_wrap") && state.text.endsWith("find_words aa\n\nf") && !state.text.includes("cc"), `after the wrap ${JSON.stringify(state)}`);
  });

  await run_case("visual y after n copies the text up to and including the match's first character", async () => {
    const page_id = "find_vis_yank";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await send_keys("/find_words");
    await sleep(400);
    await send_keys(...ENTER);
    await sleep(500);
    await send_keys("n");
    const expected = (await read_after("n")).text.replace(/\s+/g, " ").trim();
    expect(expected.endsWith("find_words aa f"), `the selection is ${JSON.stringify(expected)}`);
    await send_keys("y");
    await sleep(500);
    await send_keys(...ESCAPE);
    await send_keys(...ESCAPE);
    const mark = events.length;
    await send_keys("gi");
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === page_id, "the pasted text");
    expect(pasted.value.replace(/\s+/g, " ").trim() === expected, `y copied ${JSON.stringify(pasted.value)}, expected ${JSON.stringify(expected)}`);
  });

  await run_case("n in normal mode still steps without a selection", async () => {
    const page_id = "find_normal_n";
    await open_page("find_words", page_id, { new_tab: true });
    await send_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await send_keys(...ENTER);
    await sleep(300);
    await send_keys("n");
    await wait_highlights((read) => current_of(read) === "find_words bb" || current_of(read) === "find_words aa", "n stepping");
    expect(mode_badge(page_id) === "NORMAL", `the badge is ${mode_badge(page_id)}, expected NORMAL`);
    expect((await in_active_tab(READ_SELECTION)).text === "", "n in normal mode made a selection");
  });

  await run_case("* on a one-character visual selection finds every occurrence of that character", async () => {
    const page_id = "find_star_char";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    // The character f is on the page six times: the title twice (find and find_star_char), the three paragraphs aa to cc, and fox.
    await send_keys("*");
    await wait_toast(/^2 of 6$/, "the toast for * on one character");
  });

  await run_case("* on a lowercase visual selection skips a capitalised match", async () => {
    const page_id = "find_star_case";
    await open_page("find_case", page_id, { new_tab: true });
    await collapse_at("zeta one");
    const mark = events.length;
    await send_keys("V");
    await wait_event(mark, selection_is(page_id, "z"), "the selection on the z");
    await send_keys("e");
    await wait_event(mark, selection_is(page_id, "zeta"), "the selection of zeta");
    await send_keys("*");
    await wait_toast(/^2 of 2$/, "two matches, not three");
    await wait_highlights((read) => current_of(read) === "zeta three", "the match past Zeta");
    // n goes on past Zeta too: the next match wraps to the first lowercase one.
    await send_keys("n");
    await wait_highlights((read) => current_of(read) === "zeta one", "n skipping Zeta on the way round");
  });

  await run_case("* on a word that starts with a surrogate-pair letter takes the whole word", async () => {
    const page_id = "find_star_astral";
    await open_page("find_astral", page_id, { new_tab: true });
    // The caret goes to the first letter of the word, after "x " in the first paragraph.
    await in_active_tab(`(() => { const text = document.querySelector("p").firstChild; getSelection().collapse(text, 2); return true; })()`);
    await sleep(300);
    const mark = events.length;
    await send_keys("v");
    await wait_event(mark, badge_is(page_id, "CARET"), "the CARET badge");
    const before_star = await in_active_tab(READ_SELECTION);
    await send_keys("*");
    await wait_toast(/^2 of 2$/, `the whole word matched twice (the caret was at ${JSON.stringify(before_star)})`);
    await wait_highlights((read) => current_of(read).startsWith("\u{1D49C}bc again"), "the match in the second paragraph");
  });

  await run_case("visual n steps from the caret after j moved it past matches, and not back to the last match", async () => {
    const page_id = "find_vis_caret";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await send_keys("/find_words");
    await sleep(400);
    await send_keys(...ENTER);
    let state = await read_after("Enter");
    expect(state.focus === "find_words aa", `after Enter ${JSON.stringify(state)}`);
    await send_keys("j");
    await send_keys("j");
    await send_keys("l");
    await sleep(300);
    state = await read_after("j j l");
    expect(state.focus === "find_words cc", `after j j l ${JSON.stringify(state)}`);
    await send_keys("n");
    state = await read_after("n");
    expect(state.focus?.startsWith("find_words find_vis_") && state.focus_offset <= 1, `n went to ${JSON.stringify(state)}, expected the wrap to the title and not back to bb`);
  });

  await run_case("visual N onto a match before the anchor flips the selection", async () => {
    const page_id = "find_vis_before";
    await open_page("find_words", page_id, { new_tab: true });
    await collapse_at("find_words bb");
    await start_visual(page_id);
    await send_keys("/find_words");
    await sleep(400);
    await send_keys(...ENTER);
    let state = await read_after("Enter");
    expect(state.anchor === "find_words bb" && state.focus === "find_words cc", `after Enter ${JSON.stringify(state)}`);
    await send_keys("N");
    await read_after("N onto the anchor's own match");
    await send_keys("N");
    state = await read_after("N before the anchor");
    expect(state.text === "find_words aa\n\nf", `after the second N ${JSON.stringify(state)}`);
  });

  await run_case("a click in visual mode keeps the anchor, takes the caret end, and n then steps from there", async () => {
    const page_id = "find_vis_click";
    await open_page("find_words", page_id, { new_tab: true });
    await start_visual(page_id);
    await send_keys("/find_words");
    await sleep(400);
    await send_keys(...ENTER);
    await read_after("Enter");
    // A click collapses the page selection onto the clicked text.
    await in_active_tab(`(() => { const text = [...document.querySelectorAll("p")].find((p) => p.textContent === "find_words bb").firstChild; getSelection().collapse(text, 0); return true; })()`);
    await sleep(600);
    await send_keys("n");
    const state = await read_after("n after the click");
    // Visual mode keeps its anchor on a click and takes the clicked text as the caret end, so n goes on from bb to cc.
    expect(state.anchor === "find_words find_vis_" && state.focus === "find_words cc", `after the click and n ${JSON.stringify(state)}, expected the anchor on the title and the focus on cc`);
  });

  await run_case("a fresh visual session after an earlier search: n goes to the first match after the caret", async () => {
    const page_id = "find_vis_fresh";
    await open_page("find_words", page_id, { new_tab: true });
    await send_keys("/find_words");
    await wait_highlights((read) => total_painted(read) === 4, "the four matches");
    await send_keys(...ENTER);
    await sleep(300);
    await send_keys("n");
    await sleep(400);
    await send_keys(...ESCAPE);
    await wait_highlights((read) => total_painted(read) === 0, "the highlights cleared");
    await start_visual(page_id);
    await send_keys("n");
    const state = await read_after("n");
    // V starts at the search match aa, so the first match after the caret is bb.
    expect(state.text === "find_words aa\n\nf", `n from the new caret went to ${JSON.stringify(state)}, expected aa to bb`);
  });
}
