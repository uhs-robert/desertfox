// Key cases of the caret and visual piece. run.mjs calls run_cases with its helpers.
// The pages report each change of their selection, and the highlight style the bundle puts on the document.

import { mkdirSync } from "node:fs";
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, take_shot, run_case, expect, open_page, send_keys, sleep, events, wait_event }) {
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];
  // oasis_moonlight, the default palette, dark: the caret takes the `mode_caret` role and visual mode the `selection` role (src/content/caret/selection_colors.ts).
  const CARET_BACKGROUND = "#f0e68c";
  const VISUAL_BACKGROUND = "#24364d";

  const selection_is = (page_id, text) => (event) => event.type === "selection" && event.page_id === page_id && event.text === text;
  const style_is = (page_id, has) => (event) => event.type === "selection_style" && event.page_id === page_id && has(event.css);
  const no_style = (css) => css === "";

  // The page text is "caret p7", "foo bar.baz", "second line here". From the first word, 3w lands on "bar".
  await run_case("V, 3w, v, e, y copies the word the selection reached and shows a toast", async () => {
    await open_page("caret", "caret_yank", { new_tab: true });
    await send_keys("gV");
    await send_keys("3w");
    await send_keys("v");
    await send_keys("e");
    const mark_yank = events.length;
    await send_keys("y");
    await wait_event(mark_yank, (event) => event.type === "toast" && event.page_id === "caret_yank", "the copied toast");
    await sleep(300);
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    const mark = events.length;
    const badges = events.filter((event) => event.type === "indicator" && event.page_id === "caret_yank").map((event) => event.label).join(",");
    await send_keys("gi");
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "caret_yank", `the pasted text (badges ${badges})`);
    expect(pasted.value === "bar", `y copied "${pasted.value}", expected "bar"`);
  });

  await run_case("V shows the caret at once in the caret color, and Escape clears it with the colors", async () => {
    await open_page("caret", "caret_enter", { new_tab: true });
    const mark = events.length;
    await send_keys("gV");
    await wait_event(mark, selection_is("caret_enter", "c"), "the caret on the first character");
    await wait_event(mark, style_is("caret_enter", (css) => css.includes(CARET_BACKGROUND)), "the caret color");
    await send_keys("v");
    await wait_event(mark, style_is("caret_enter", (css) => css.includes(VISUAL_BACKGROUND)), "the visual color");
    const mark_escape = events.length;
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await wait_event(mark_escape, selection_is("caret_enter", ""), "an empty selection after Escape");
    await wait_event(mark_escape, style_is("caret_enter", no_style), "no highlight style after Escape");
    const mark_again = events.length;
    await send_keys("gV");
    await wait_event(mark_again, selection_is("caret_enter", "c"), "the caret again after leaving");
    await send_keys("-k", "Escape");
  });

  await run_case("switching tabs away from caret mode clears the highlight, and V works after coming back", async () => {
    await open_page("caret", "caret_tab", { new_tab: true });
    const mark = events.length;
    await send_keys("gV");
    await wait_event(mark, selection_is("caret_tab", "c"), "the caret");
    const mark_switch = events.length;
    // Caret mode binds no tab key, so the switch is Firefox's own Ctrl+Page Down.
    await send_keys("-M", "ctrl", "-k", "Next", "-m", "ctrl");
    await wait_event(mark_switch, selection_is("caret_tab", ""), "an empty selection after the tab switch");
    await wait_event(mark_switch, style_is("caret_tab", no_style), "no highlight style after the tab switch");
    await send_keys("-M", "ctrl", "-k", "Prior", "-m", "ctrl");
    await sleep(500);
    const again = events.length;
    await send_keys("gV");
    await wait_event(again, selection_is("caret_tab", "c"), "the caret after coming back");
    await send_keys("-k", "Escape");
  });

  await run_case("j k 0 $ move by screen line in a wrapped paragraph", async () => {
    await open_page("caret_wrap", "caret_wrap", { new_tab: true });
    const mark = events.length;
    // The paragraph wraps to abc, def, ghi, jkl. The first visible text is the title above it.
    await send_keys("gV");
    await send_keys("j");
    await wait_event(mark, selection_is("caret_wrap", "a"), "the first screen line");
    await send_keys("j");
    await wait_event(mark, selection_is("caret_wrap", "d"), "j to the second screen line");
    await send_keys("$");
    await wait_event(mark, selection_is("caret_wrap", "f"), "$ to the end of the screen line");
    await send_keys("0");
    await wait_event(mark, selection_is("caret_wrap", "d"), "0 to the start of the screen line");
    await send_keys("k");
    await wait_event(mark, selection_is("caret_wrap", "a"), "k to the first screen line");
    await send_keys("-k", "Escape");
  });

  await run_case("V selects whole screen lines of a wrapped paragraph, j grows it, o swaps the ends and y copies the lines", async () => {
    await open_page("caret_wrap", "caret_wrap_lines", { new_tab: true });
    const lines_are = (text) => (event) => event.type === "selection" && event.page_id === "caret_wrap_lines" && event.text.replace(/\s+/g, " ").trim() === text;
    const mark = events.length;
    await send_keys("gV");
    await send_keys("jj");
    await wait_event(mark, selection_is("caret_wrap_lines", "d"), "the caret on the second screen line");
    await send_keys("V");
    await wait_event(mark, lines_are("def"), "V selecting the whole second screen line");
    await send_keys("j");
    await wait_event(mark, lines_are("def ghi"), "j growing the selection by a screen line");
    // After o the caret end is the top line, so k grows the selection upward instead of shrinking it.
    await send_keys("o");
    await send_keys("k");
    await wait_event(mark, lines_are("abc def ghi"), "o then k growing the selection upward");
    const mark_yank = events.length;
    await send_keys("y");
    await wait_event(mark_yank, (event) => event.type === "toast" && event.page_id === "caret_wrap_lines", "the copied toast");
    await sleep(300);
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    const mark_paste = events.length;
    await send_keys("gi");
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark_paste, (event) => event.type === "input" && event.page_id === "caret_wrap_lines", "the pasted text");
    expect(pasted.value.replace(/\s+/g, " ").trim() === "abc def ghi", `y copied "${pasted.value}", expected the lines abc, def and ghi`);
  });

  await run_case("in caret mode / opens the DesertFox search line, not Firefox Quick Find, and ' does nothing", async () => {
    await open_page("caret", "caret_quick_find", { new_tab: true });
    const mark = events.length;
    await send_keys("gV");
    await wait_event(mark, selection_is("caret_quick_find", "c"), "the caret on the first character");
    // Quick Find would take the keys after it, so a caret that still moves shows that it did not open.
    await send_keys("'");
    await send_keys("l");
    await wait_event(mark, selection_is("caret_quick_find", "a"), "l moving the caret after '");
    const mark_search = events.length;
    await send_keys("/bar");
    await sleep(400);
    await send_keys("-k", "Return");
    await wait_event(mark_search, selection_is("caret_quick_find", "b"), "the caret on the match of /bar");
    await send_keys("-k", "Escape");
  });

  await run_case("j and k keep the column over a shorter line", async () => {
    await open_page("caret_columns", "caret_columns", { new_tab: true });
    const mark = events.length;
    await send_keys("gV");
    await send_keys("j");
    await wait_event(mark, selection_is("caret_columns", "a"), "the first line");
    await send_keys("lllll");
    await wait_event(mark, selection_is("caret_columns", "f"), "column 5");
    await send_keys("j");
    await wait_event(mark, selection_is("caret_columns", "b"), "the short line");
    const mark_back = events.length;
    await send_keys("j");
    await wait_event(mark_back, selection_is("caret_columns", "f"), "column 5 again on the long line");
    await send_keys("-k", "Escape");
  });

  await run_case("j keeps the column while the next line is below the screen", async () => {
    await open_page("caret_long_columns", "caret_long", { new_tab: true });
    await send_keys("gV");
    await send_keys("j");
    await send_keys("lllll");
    await send_keys("120j");
    await sleep(1500);
    const last = events.filter((event) => event.type === "selection" && event.page_id === "caret_long").at(-1);
    expect(last.scroll_y > 0, "the page did not scroll down");
    expect(last.text === "f", `after 120 j the caret is on "${last.text}", expected "f" in column 5`);
    await send_keys("-k", "Escape");
  });

  await run_case("the caret scrolls a nested scroller to stay in view", async () => {
    await open_page("caret_nested", "caret_nested", { new_tab: true });
    await send_keys("gV");
    await send_keys("j");
    await send_keys("60j");
    await sleep(1500);
    const last = events.filter((event) => event.type === "selection" && event.page_id === "caret_nested").at(-1);
    expect(last.pane_top > 300, `the pane scrolled to ${last.pane_top}, the caret is off its view`);
    expect(last.top >= 0 && last.top < 400, `the caret is at y ${last.top}, outside the pane`);
    await send_keys("-k", "Escape");
  });

  await run_case("V on a page scrolled into the middle of a paragraph starts on a visible character", async () => {
    await open_page("caret_scrolled", "caret_scrolled", { new_tab: true });
    await sleep(500);
    const mark = events.length;
    await send_keys("gV");
    const shown = await wait_event(mark, (event) => event.type === "selection" && event.page_id === "caret_scrolled" && event.text !== "", "a caret");
    expect(shown.top !== null && shown.top > -30 && shown.top < 1000, `the caret starts at y ${shown.top}, off screen`);
    // Starting at the paragraph's first character would scroll the page back up to it.
    expect(shown.scroll_y > 2500, `the page scrolled from y 3000 to ${shown.scroll_y}`);
    await send_keys("-k", "Escape");
  });

  // A hint starts the mode at its element: label "a" is the only element, so it is picked at once.
  const hint_into = async (page_id, flag, target) => {
    await open_page("caret_hint", page_id, { new_tab: true });
    const mark = events.length;
    await send_keys(`:hint ${flag} --custom --selector=${target}`, "-k", "Return");
    await sleep(300);
    await send_keys("a");
    return mark;
  };
  const badge_is = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;

  await run_case("hint --caret on a paragraph starts caret mode on its first character", async () => {
    const mark = await hint_into("hint_caret", "--caret", "#pick");
    await wait_event(mark, badge_is("hint_caret", "CARET"), "the CARET badge");
    await wait_event(mark, selection_is("hint_caret", "b"), "the caret on the first character of the paragraph");
    await send_keys("-k", "Escape");
  });

  await run_case("hint --visual on a paragraph starts visual mode on its first character", async () => {
    const mark = await hint_into("hint_visual", "--visual", "#pick");
    await wait_event(mark, badge_is("hint_visual", "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is("hint_visual", "b"), "one character selected");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
  });

  await run_case("hint --caret on an image or a field jumps to the next text", async () => {
    const image_mark = await hint_into("hint_image", "--caret", "#pic");
    await wait_event(image_mark, selection_is("hint_image", "g"), "the caret on the text after the image");
    await send_keys("-k", "Escape");
    const field_mark = await hint_into("hint_field", "--caret", "#field");
    await wait_event(field_mark, selection_is("hint_field", "o"), "the caret on the text after the field");
    await send_keys("-k", "Escape");
  });

  await run_case("hint --caret with no text after the element shows a toast and stays in normal mode", async () => {
    const mark = await hint_into("hint_none", "--caret", "#last");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "hint_none", "the No text here toast");
    await wait_event(mark, badge_is("hint_none", "NORMAL"), "the NORMAL badge");
  });

  // The frame's page has no reporter, so the badge and the missing notice show that caret mode started in it.
  await run_case("hint --caret on an element inside a same-origin frame starts caret mode there", async () => {
    const mark = await hint_into("hint_frame", "--caret", "#inner");
    await wait_event(mark, badge_is("hint_frame", "CARET"), "the CARET badge");
    await sleep(500);
    expect(!events.slice(mark).some((event) => event.type === "toast" && event.page_id === "hint_frame"), "a notice showed");
    await send_keys("-k", "Escape");
  });

  await run_case(";v and ;V pick a hint for caret and visual mode", async () => {
    await open_page("caret_hint", "hint_keys", { new_tab: true });
    const mark = events.length;
    await send_keys(";v");
    await sleep(300);
    await send_keys("a");
    await wait_event(mark, badge_is("hint_keys", "CARET"), "the CARET badge after ;v");
    await send_keys("-k", "Escape");
    const mark_visual = events.length;
    await send_keys(";V");
    await sleep(300);
    await send_keys("a");
    await wait_event(mark_visual, badge_is("hint_keys", "VISUAL"), "the VISUAL badge after ;V");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
  });

  await run_case("v starts caret mode and V visual mode, with no hint", async () => {
    await open_page("caret", "caret_plain_keys", { new_tab: true });
    const mark = events.length;
    await send_keys("v");
    await wait_event(mark, badge_is("caret_plain_keys", "CARET"), "the CARET badge after v");
    await send_keys("-k", "Escape");
    const mark_visual = events.length;
    await send_keys("V");
    await wait_event(mark_visual, badge_is("caret_plain_keys", "VISUAL"), "the VISUAL badge after V");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
  });

  await run_case(";; opens the command line with hint typed, so flags can follow", async () => {
    await open_page("caret_hint", "hint_line", { new_tab: true });
    const mark = events.length;
    await send_keys(";;");
    await sleep(500);
    await send_keys(" --caret --custom --selector=#pick", "-k", "Return");
    await sleep(300);
    await send_keys("a");
    await wait_event(mark, badge_is("hint_line", "CARET"), "the CARET badge from the hint typed into the line");
    await send_keys("-k", "Escape");
  });

  // `s` names no engine, so the default_engine setting decides, and the test config points the built-in duck at the test server.
  await run_case("V, 3w, v, e, s searches the selected word", async () => {
    await open_page("caret", "caret_search", { new_tab: true });
    const mark = events.length;
    for (const keys of ["gV", "3w", "v", "e", "s"]) await send_keys(keys);
    const result = await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "search_result", "the search result page");
    expect(new URLSearchParams(result.search).get("q") === "bar", `searched "${new URLSearchParams(result.search).get("q")}", expected "bar"`);
  });

  // gV starts on the heading "caret <page id>", and its first paragraph is that heading. f, F, t and T read the next key as the target.
  await run_case("f F t T move to a typed character within the paragraph", async () => {
    await open_page("caret", "caret_find", { new_tab: true });
    await send_keys("gV");
    // The heading is "caret caret_find": the first t is at 4, the underscore at 11 and the second c at 6.
    for (const [keys, text] of [["ft", "t"], ["Fc", "c"], ["t_", "t"], ["Tc", "a"]]) {
      const mark = events.length;
      await send_keys(keys);
      await wait_event(mark, selection_is("caret_find", text), `${keys} to "${text}"`);
      // The find lights its matches and the same key family repeats it, so Escape ends it before the next find.
      await send_keys("-k", "Escape");
    }
    await send_keys("-k", "Escape");
  });

  await run_case("Escape cancels a pending find and stays in caret mode, and a bound key is a target", async () => {
    await open_page("caret", "caret_find_cancel", { new_tab: true });
    await send_keys("gV");
    await send_keys("f");
    await send_keys("-k", "Escape");
    let mark = events.length;
    await send_keys("l");
    await wait_event(mark, selection_is("caret_find_cancel", "a"), "l after the cancelled find");
    // w is bound to a word motion, and here it is the target: the heading has no w, so the caret stays and the find is over.
    await send_keys("fw");
    await send_keys("-k", "Escape");
    mark = events.length;
    await send_keys("fd");
    await wait_event(mark, selection_is("caret_find_cancel", "d"), "fd after a find with no match");
    await send_keys("-k", "Escape");
  });

  // A space arrives as the token <Space>, longer than one character, and is still a target.
  await run_case("f then Space moves to the first space of the paragraph", async () => {
    await open_page("caret", "caret_find_space", { new_tab: true });
    await send_keys("gV");
    const mark = events.length;
    await send_keys("f");
    await send_keys(" ");
    await wait_event(mark, selection_is("caret_find_space", " "), "f then Space to the space after caret");
    await send_keys("-k", "Escape");
  });

  // /caret_ft holds forty rows "row N x", 100 pixels apart. The highlights are read from the page's own world, by the names of the character find and of a kept `/` search.
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return (await browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))[0]; })()`).then((value) => {
    if (value?.error) throw new Error(`in the tab: ${JSON.stringify(value)}`);
    return value;
  });
  const READ_FT = `JSON.parse(window.wrappedJSObject.eval(${JSON.stringify(`JSON.stringify((() => {
    const texts = (name) => { const found = []; CSS.highlights.get(name)?.forEach((range) => found.push(range.startContainer.data)); return found; };
    return { all: texts("oasis-ft"), current: texts("oasis-ft-current"), search: texts("oasis-find").length + texts("oasis-find-current").length, y: scrollY };
  })())`)}))`;
  const row_of = (text) => Number(/row (\d+)/.exec(text)?.[1]);
  const lit = (state) => state.all.length + state.current.length;
  async function wait_ft(predicate, what) {
    let state;
    for (let attempt = 0; attempt < 40; attempt++) {
      state = await in_active_tab(READ_FT);
      if (predicate(state)) return state;
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}, last state ${JSON.stringify(state)}`);
  }
  const current_row = (state) => (state.current.length === 1 ? row_of(state.current[0]) : -1);
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  if (shot_dir) mkdirSync(shot_dir, { recursive: true });

  await run_case("fx lights the visible matches, f and F repeat across the page and scroll it, 3f counts", async () => {
    await open_page("caret_ft", "ft_repeat", { new_tab: true });
    await send_keys("gV");
    await send_keys("fx");
    const first = await wait_ft((state) => current_row(state) === 0 && lit(state) >= 3, "the matches of the first screen with row 0 current");
    expect(lit(first) < 25, `lit ${lit(first)} matches of forty rows: only the visible ones and a screen around should be lit`);
    expect(first.y === 0, `the first f scrolled to ${first.y}`);
    if (shot_dir) await take_shot(`${shot_dir}/char-find-highlights.png`);
    await send_keys("3f");
    await wait_ft((state) => current_row(state) === 3, "3f to row 3");
    // Far past the first screen: the page scrolls and the new screen is lit, with the neighbours of the current row.
    for (let step = 0; step < 14; step++) await send_keys("f");
    const far = await wait_ft((state) => current_row(state) === 17 && state.y > 0, "row 17 current after the page scrolled");
    expect(far.all.some((text) => row_of(text) === 16) || far.all.some((text) => row_of(text) === 18), `the new screen is not lit: ${JSON.stringify(far)}`);
    await send_keys("F");
    await wait_ft((state) => current_row(state) === 16, "F back to row 16");
    await send_keys("-k", "Escape");
  });

  await run_case("t after f starts a till find, and the match next to the caret is the current one", async () => {
    await open_page("caret_ft", "ft_till", { new_tab: true });
    await send_keys("gV");
    await send_keys("fx");
    await wait_ft((state) => current_row(state) === 0, "row 0 current");
    await send_keys("t");
    await wait_ft((state) => lit(state) === 0, "no highlights while the till find waits for its target");
    await send_keys("x");
    await wait_ft((state) => current_row(state) === 1, "the x of row 1 current after tx");
    await send_keys("t");
    await wait_ft((state) => current_row(state) === 2, "t repeats the till find to row 2");
    await send_keys("T");
    await wait_ft((state) => current_row(state) === 1, "T repeats it back to row 1");
    await send_keys("-k", "Escape");
  });

  await run_case("another key, Escape and a mode change clear the highlights, and ; repeats without them", async () => {
    await open_page("caret_ft", "ft_end", { new_tab: true });
    await send_keys("gV");
    await send_keys("fx");
    await wait_ft((state) => current_row(state) === 0, "row 0 current");
    await send_keys("l");
    await wait_ft((state) => lit(state) === 0, "cleared by l");
    await send_keys(";");
    await sleep(400);
    expect(lit(await in_active_tab(READ_FT)) === 0, "; after the end drew highlights");
    await send_keys("fx");
    await wait_ft((state) => lit(state) > 0, "lit again by a new find");
    await send_keys("-k", "Escape");
    await wait_ft((state) => lit(state) === 0, "cleared by Escape");
    await send_keys("fx");
    await wait_ft((state) => lit(state) > 0, "lit once more");
    await send_keys("v");
    await wait_ft((state) => lit(state) === 0, "cleared by a mode change to visual");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
  });

  await run_case("scrolling the page moves the highlights while the find is live and stops when it ends", async () => {
    await open_page("caret_ft", "ft_scroll", { new_tab: true });
    await send_keys("gV");
    await send_keys("fx");
    await wait_ft((state) => current_row(state) === 0, "row 0 current");
    await in_active_tab("window.scrollTo(0, 2400); 0");
    await wait_ft((state) => state.all.some((text) => row_of(text) >= 22), "highlights on the scrolled screen");
    await send_keys("l");
    await wait_ft((state) => lit(state) === 0, "cleared by l");
    await in_active_tab("window.scrollTo(0, 0); 0");
    await sleep(500);
    expect(lit(await in_active_tab(READ_FT)) === 0, "a scroll after the end drew highlights");
    await send_keys("-k", "Escape");
  });

  await run_case("a kept / search stays lit through a character find and after it ends", async () => {
    await open_page("caret_ft", "ft_search", { new_tab: true });
    await send_keys("/row 3");
    await send_keys("-k", "Return");
    const kept = await wait_ft((state) => state.search > 0, "the kept search highlights");
    await send_keys("gV");
    await send_keys("fx");
    await wait_ft((state) => lit(state) > 0 && state.search === kept.search, "both sets lit");
    await send_keys("l");
    const after = await wait_ft((state) => lit(state) === 0, "the character find cleared");
    expect(after.search === kept.search, `the kept search lost highlights: ${kept.search} then ${after.search}`);
    await send_keys("-k", "Escape");
  });
}
