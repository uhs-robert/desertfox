// A grid of selection sources against the caret and visual modes. Each cell asserts the selection's two ends, read from `getSelection()` on the page, after the mode took the source and again after one `l`.
// The sources are script stand-ins. The harness has no pointer, so click and drag send no pointer events. A drag is `setBaseAndExtent` and a click is a collapsed selection, which is all the caret code reads. The page script uses the drag's call on another span, but keeps its own row.
// "Before" means the source exists when the mode starts. "During" means the mode is already active when the source arrives.
// The expected values are what the code did when the grid was written. A cell is not a promise that the behavior is right.

export const areas = ["caret", "find"];

import { evaluate_in_background } from "./rdp.mjs";

// "the needle sits here" is the fixture's text node, far below the first screen. Offsets 4 to 10 are "needle" and 11 to 15 are "sits". A click uses "start of page", which is on screen, at offset 6.
const SOURCES = ["drag_forward", "drag_backward", "click", "browser_find", "search_position", "page_script"];
const MODES = ["caret", "visual", "line_visual"];
const TIMINGS = ["before", "during"];

// Keys that enter each mode from normal mode, and the badge each key shows. Line visual goes through caret mode, because normal mode has no key for it.
const ENTRY = { caret: [["v", "CARET"]], visual: [["V", "VISUAL"]], line_visual: [["v", "CARET"], ["V", "V-LINE"]] };

const EXPECTED = {
  "drag_forward caret before": "\"e\" anchor the :9 focus the :10 | after l \" \" anchor the :10 focus the :11",
  "drag_forward caret during": "\"needle\" anchor the :4 focus the :10 | after l \" \" anchor the :10 focus the :11",
  "drag_forward visual before": "\"needle\" anchor the :4 focus the :10 | after l \"needle \" anchor the :4 focus the :11",
  "drag_forward visual during": "\"needle\" anchor the :4 focus the :10 | after l \"needle \" anchor the :4 focus the :11",
  "drag_forward line_visual before": "\"the needle s...(20 characters)\" anchor the :0 focus the :20 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "drag_forward line_visual during": "\"needle\" anchor the :4 focus the :10 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "drag_backward caret before": "\"n\" anchor the :4 focus the :5 | after l \"e\" anchor the :5 focus the :6",
  "drag_backward caret during": "\"needle\" anchor the :10 focus the :4 | after l \"e\" anchor the :5 focus the :6",
  "drag_backward visual before": "\"needle\" anchor the :4 focus the :10 | after l \"eedle\" anchor the :5 focus the :10",
  "drag_backward visual during": "\"needle\" anchor the :10 focus the :4 | after l \"eedle\" anchor the :5 focus the :10",
  "drag_backward line_visual before": "\"the needle s...(20 characters)\" anchor the :0 focus the :20 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "drag_backward line_visual during": "\"needle\" anchor the :10 focus the :4 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "click caret before": "\"o\" anchor star:6 focus star:7 | after l \"f\" anchor star:7 focus star:8",
  "click caret during": "\"\" anchor star:6 focus star:6 | after l \"f\" anchor star:7 focus star:8",
  "click visual before": "\"o\" anchor star:6 focus star:7 | after l \"of\" anchor star:6 focus star:8",
  "click visual during": "\"\" anchor star:6 focus star:6 | after l \"caret_bug_fi...(49 characters)\" anchor care:0 focus star:8",
  "click line_visual before": "\"start of pag...(13 characters)\" anchor star:0 focus star:13 | after l \"start of pag...(13 characters)\" anchor star:0 focus star:13",
  "click line_visual during": "\"\" anchor star:6 focus star:6 | after l \"caret_bug_fi...(59 characters)\" anchor care:0 focus star:13",
  "browser_find caret before": "\"e\" anchor the :9 focus the :10 | after l \" \" anchor the :10 focus the :11",
  "browser_find caret during": "\"needle\" anchor the :4 focus the :10 | after l \" \" anchor the :10 focus the :11",
  "browser_find visual before": "\"needle\" anchor the :4 focus the :10 | after l \"needle \" anchor the :4 focus the :11",
  "browser_find visual during": "\"needle\" anchor the :4 focus the :10 | after l \"needle \" anchor the :4 focus the :11",
  "browser_find line_visual before": "\"the needle s...(20 characters)\" anchor the :0 focus the :20 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "browser_find line_visual during": "\"needle\" anchor the :4 focus the :10 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "search_position caret before": "\"n\" anchor the :4 focus the :5 | after l \"e\" anchor the :5 focus the :6",
  "search_position caret during": "\"n\" anchor the :4 focus the :5 | after l \"e\" anchor the :5 focus the :6",
  "search_position visual before": "\"n\" anchor the :4 focus the :5 | after l \"ne\" anchor the :4 focus the :6",
  "search_position visual during": "\"caret_bug_fi...(1921 characters)\" anchor care:0 focus the :5 | after l \"caret_bug_fi...(1922 characters)\" anchor care:0 focus the :6",
  "search_position line_visual before": "\"the needle s...(20 characters)\" anchor the :0 focus the :20 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "search_position line_visual during": "\"caret_bug_fi...(1941 characters)\" anchor care:0 focus the :20 | after l \"caret_bug_fi...(1941 characters)\" anchor care:0 focus the :20",
  "page_script caret before": "\"s\" anchor the :14 focus the :15 | after l \" \" anchor the :15 focus the :16",
  "page_script caret during": "\"sits\" anchor the :11 focus the :15 | after l \" \" anchor the :15 focus the :16",
  "page_script visual before": "\"sits\" anchor the :11 focus the :15 | after l \"sits \" anchor the :11 focus the :16",
  "page_script visual during": "\"sits\" anchor the :11 focus the :15 | after l \"sits \" anchor the :11 focus the :16",
  "page_script line_visual before": "\"the needle s...(20 characters)\" anchor the :0 focus the :20 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
  "page_script line_visual during": "\"sits\" anchor the :11 focus the :15 | after l \"the needle s...(20 characters)\" anchor the :0 focus the :20",
};

export async function run_cases({ run_case, expect, open_page, press_keys, barrier, wait_cmdline, wait_event, events, rdp, extension_id, in_active_tab, badge_is, is_selection_of, press_and_wait_for_move, escape_to_normal }) {
  const set_selection = (from, to) => in_active_tab(`(() => { const text = [...document.querySelectorAll('p')].find((p) => p.textContent === 'the needle sits here').firstChild; getSelection().setBaseAndExtent(text, ${from}, text, ${to}); return true; })()`);
  // A click lands on the paragraph at the top of the page, which is on screen: a collapsed selection off screen is not where the caret starts.
  const click_on_screen = () => in_active_tab(`(() => { const text = [...document.querySelectorAll('p')].find((p) => p.textContent === 'start of page').firstChild; getSelection().collapse(text, 6); return true; })()`);
  const browser_find = () => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: 'window.find("needle")' }); })()`);
  async function search_for_needle() {
    await press_keys("/");
    await wait_cmdline((line) => line.open && line.focused, "the search line to open");
    await press_keys("-d", "30", "needle");
    await wait_cmdline((line) => line.open && line.value === "needle", "the search line to hold needle");
    await press_keys("-k", "Return");
    await wait_cmdline((line) => !line.open, "the search line to close");
  }

  const MAKE_SOURCE = {
    drag_forward: () => set_selection(4, 10),
    drag_backward: () => set_selection(10, 4),
    click: click_on_screen,
    browser_find: browser_find,
    search_position: search_for_needle,
    page_script: () => set_selection(11, 15),
  };

  async function make_source(source, page_id) {
    const mark = events.length;
    await MAKE_SOURCE[source]();
    // A search leaves the page selection alone, so it reports nothing.
    if (source !== "search_position") await wait_event(mark, is_selection_of(page_id), `the ${source} selection report`);
    await barrier(page_id);
  }

  async function enter(page_id, mode) {
    for (const [key, badge] of ENTRY[mode]) {
      const mark = events.length;
      await press_keys(key);
      await wait_event(mark, badge_is(page_id, badge), `the ${badge} badge after ${key}`);
    }
    await barrier(page_id);
  }

  // The first caret session loads the caret bundle, and the load cancels plain keys. A visit to caret mode and back loads it before the source and leaves no selection.
  async function load_caret_bundle(page_id) {
    await press_and_wait_for_move(page_id, "gV", "the caret on the title");
    await escape_to_normal(page_id);
  }

  const READ = `(() => { const s = getSelection(); const at = (node, offset) => (node ? node.data.slice(0, 4) : "none") + ":" + offset; return JSON.stringify({ text: String(s), anchor: at(s.anchorNode, s.anchorOffset), focus: at(s.focusNode, s.focusOffset) }); })()`;
  const read_ends = async () => {
    const { text, anchor, focus } = JSON.parse(await in_active_tab(READ));
    const shown = text.length > 12 ? `${text.slice(0, 12)}...(${text.length} characters)` : text;
    return `${JSON.stringify(shown)} anchor ${anchor} focus ${focus}`;
  };

  for (const source of SOURCES) {
    for (const mode of MODES) {
      for (const timing of TIMINGS) {
        const cell = `${source} ${mode} ${timing}`;
        await run_case(`grid: ${cell}`, async () => {
          const page_id = `grid_${source}_${mode}_${timing}`;
          await open_page("caret_bug_find", page_id, { new_tab: true });
          await load_caret_bundle(page_id);
          if (timing === "before") {
            await make_source(source, page_id);
            await enter(page_id, mode);
          } else {
            await enter(page_id, mode);
            await make_source(source, page_id);
          }
          const entered = await read_ends();
          await press_keys("l");
          await barrier(page_id);
          const after_l = await read_ends();
          const got = `${entered} | after l ${after_l}`;
          expect(EXPECTED[cell] === got, `${cell}: got ${got}, expected ${EXPECTED[cell]}`);
          await escape_to_normal(page_id);
        });
      }
    }
  }
}
