// Key cases of the caret and visual piece. run.mjs calls run_cases with its helpers.
// The pages report each change of their selection, and the highlight style the bundle puts on the document.

import { mkdirSync } from "node:fs";

export const areas = ["caret", "find"];

export async function run_cases({ take_shot, run_case, expect, expect_absent, open_page, press_keys, poll_until, barrier, scroll_of, wait_cmdline, settle_focus, became_visible, last_scroll_y, events, wait_event, in_active_tab, hint_label_count, badge_is, is_selection_of, press_and_wait_for_move, escape_to_normal, run_line, type_in_line }) {
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];
  // oasis_moonlight, the default palette, dark: the caret takes the `mode_caret` role and visual mode the `selection` role (src/content/caret/selection_colors.ts).
  const CARET_BACKGROUND = "#f0e68c";
  const VISUAL_BACKGROUND = "#24364d";

  const selection_is = (page_id, text) => (event) => event.type === "selection" && event.page_id === page_id && event.text === text;
  const style_is = (page_id, has) => (event) => event.type === "selection_style" && event.page_id === page_id && has(event.css);
  const no_style = (css) => css === "";

  // The last selection report after the mark, once it passes `accept`. A count such as 120j moves the caret in one step, so its report is the last one.
  async function wait_for_last_selection(page_id, mark, accept, what) {
    const last = () => events.slice(mark).filter(is_selection_of(page_id)).at(-1);
    try {
      await poll_until(what, () => last() && accept(last()));
    } catch (error) {
      throw new Error(`${error.message}, the last selection report is ${JSON.stringify(last())}`);
    }
    return last();
  }
  // The pasted text comes from an input the page focuses: gi, then Ctrl+V, each after its effect.
  async function paste_into_field(page_id) {
    const mark = events.length;
    await press_keys("gi");
    await wait_event(mark, badge_is(page_id, "INSERT"), "the INSERT badge after gi");
    await press_keys(...paste_ctrl_v);
    return wait_event(mark, (event) => event.type === "input" && event.page_id === page_id, "the pasted text");
  }

  // The page text is "caret p7", "foo bar.baz", "second line here". From the first word, 3w lands on "bar".
  await run_case("V, 3w, v, e, y copies the word the selection reached and shows a toast", async () => {
    await open_page("caret", "caret_yank", { new_tab: true });
    await press_and_wait_for_move("caret_yank", "gV", "the caret");
    await press_and_wait_for_move("caret_yank", "3w", "3w to move the caret");
    let mark = events.length;
    await press_keys("v");
    await wait_event(mark, badge_is("caret_yank", "VISUAL"), "the VISUAL badge");
    await press_and_wait_for_move("caret_yank", "e", "e to extend the selection");
    const mark_yank = events.length;
    await press_keys("y");
    await wait_event(mark_yank, (event) => event.type === "toast" && event.page_id === "caret_yank", "the copied toast");
    await escape_to_normal("caret_yank");
    const pasted = await paste_into_field("caret_yank");
    expect(pasted.value === "bar", `y copied "${pasted.value}", expected "bar"`);
  });

  await run_case("V shows the caret at once in the caret color, and Escape clears it with the colors", async () => {
    await open_page("caret", "caret_enter", { new_tab: true });
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, selection_is("caret_enter", "c"), "the caret on the first character");
    await wait_event(mark, style_is("caret_enter", (css) => css.includes(CARET_BACKGROUND)), "the caret color");
    await press_keys("v");
    await wait_event(mark, style_is("caret_enter", (css) => css.includes(VISUAL_BACKGROUND)), "the visual color");
    const mark_escape = events.length;
    await escape_to_normal("caret_enter");
    await wait_event(mark_escape, selection_is("caret_enter", ""), "an empty selection after Escape");
    await wait_event(mark_escape, style_is("caret_enter", no_style), "no highlight style after Escape");
    const mark_again = events.length;
    await press_keys("gV");
    await wait_event(mark_again, selection_is("caret_enter", "c"), "the caret again after leaving");
    await escape_to_normal("caret_enter");
  });

  await run_case("switching tabs away from caret mode clears the highlight, and V works after coming back", async () => {
    await open_page("caret", "caret_tab", { new_tab: true });
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, selection_is("caret_tab", "c"), "the caret");
    const mark_switch = events.length;
    // Caret mode binds no tab key, so the switch is Firefox's own Ctrl+Page Down.
    await press_keys("-M", "ctrl", "-k", "Next", "-m", "ctrl");
    await wait_event(mark_switch, selection_is("caret_tab", ""), "an empty selection after the tab switch");
    await wait_event(mark_switch, style_is("caret_tab", no_style), "no highlight style after the tab switch");
    const mark_back = events.length;
    await press_keys("-M", "ctrl", "-k", "Prior", "-m", "ctrl");
    await wait_event(mark_back, became_visible("caret_tab"), "the page to come back to the front");
    await settle_focus();
    const again = events.length;
    await press_keys("gV");
    await wait_event(again, selection_is("caret_tab", "c"), "the caret after coming back");
    await escape_to_normal("caret_tab");
  });

  await run_case("j k 0 $ move by screen line in a wrapped paragraph", async () => {
    await open_page("caret_wrap", "caret_wrap", { new_tab: true });
    const mark = events.length;
    // The paragraph wraps to abc, def, ghi, jkl. The first visible text is the title above it.
    await press_and_wait_for_move("caret_wrap", "gV", "the caret on the title");
    await press_keys("j");
    await wait_event(mark, selection_is("caret_wrap", "a"), "the first screen line");
    await press_keys("j");
    await wait_event(mark, selection_is("caret_wrap", "d"), "j to the second screen line");
    await press_keys("$");
    await wait_event(mark, selection_is("caret_wrap", "f"), "$ to the end of the screen line");
    await press_keys("0");
    await wait_event(mark, selection_is("caret_wrap", "d"), "0 to the start of the screen line");
    await press_keys("k");
    await wait_event(mark, selection_is("caret_wrap", "a"), "k to the first screen line");
    await escape_to_normal("caret_wrap");
  });

  await run_case("V selects whole screen lines of a wrapped paragraph, j grows it, o swaps the ends and y copies the lines", async () => {
    await open_page("caret_wrap", "caret_wrap_lines", { new_tab: true });
    const lines_are = (text) => (event) => event.type === "selection" && event.page_id === "caret_wrap_lines" && event.text.replace(/\s+/g, " ").trim() === text;
    const mark = events.length;
    await press_and_wait_for_move("caret_wrap_lines", "gV", "the caret on the title");
    await press_keys("jj");
    await wait_event(mark, selection_is("caret_wrap_lines", "d"), "the caret on the second screen line");
    await press_keys("V");
    await wait_event(mark, lines_are("def"), "V selecting the whole second screen line");
    await press_keys("j");
    await wait_event(mark, lines_are("def ghi"), "j growing the selection by a screen line");
    // After o the caret end is the top line, so k grows the selection upward instead of shrinking it. o reports nothing, so a barrier orders it before k.
    await press_keys("o");
    await barrier("caret_wrap_lines");
    await press_keys("k");
    await wait_event(mark, lines_are("abc def ghi"), "o then k growing the selection upward");
    const mark_yank = events.length;
    await press_keys("y");
    await wait_event(mark_yank, (event) => event.type === "toast" && event.page_id === "caret_wrap_lines", "the copied toast");
    await escape_to_normal("caret_wrap_lines");
    const pasted = await paste_into_field("caret_wrap_lines");
    expect(pasted.value.replace(/\s+/g, " ").trim() === "abc def ghi", `y copied "${pasted.value}", expected the lines abc, def and ghi`);
  });

  await run_case("in caret mode / opens the DesertFox search line, not Firefox Quick Find, and ' does nothing", async () => {
    await open_page("caret", "caret_quick_find", { new_tab: true });
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, selection_is("caret_quick_find", "c"), "the caret on the first character");
    // Quick Find would take the keys after it, so a caret that still moves shows that it did not open. The barrier key goes to the page only when Quick Find stayed shut.
    await press_keys("'");
    await barrier("caret_quick_find");
    await press_keys("l");
    await wait_event(mark, selection_is("caret_quick_find", "a"), "l moving the caret after '");
    const mark_search = events.length;
    await press_keys("/bar");
    await wait_cmdline((line) => line.open && line.value === "bar", "the DesertFox search line to hold bar");
    await press_keys("-k", "Return");
    await wait_event(mark_search, selection_is("caret_quick_find", "b"), "the caret on the match of /bar");
    await escape_to_normal("caret_quick_find");
  });

  await run_case("Enter on a search lands the caret on text the page added after caret mode started", async () => {
    await open_page("caret_added", "caret_added", { new_tab: true });
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, selection_is("caret_added", "c"), "the caret on the first character");
    await wait_event(mark, (event) => event.type === "text_added" && event.page_id === "caret_added", "the text the page adds");
    const mark_search = events.length;
    await press_keys("/zebra");
    await wait_cmdline((line) => line.open && line.value === "zebra", "the search line to hold zebra");
    await press_keys("-k", "Return");
    await wait_event(mark_search, selection_is("caret_added", "z"), "the caret on the added match");
    await escape_to_normal("caret_added");
  });

  await run_case("j and k keep the column over a shorter line", async () => {
    await open_page("caret_columns", "caret_columns", { new_tab: true });
    const mark = events.length;
    await press_and_wait_for_move("caret_columns", "gV", "the caret on the title");
    await press_keys("j");
    await wait_event(mark, selection_is("caret_columns", "a"), "the first line");
    await press_keys("lllll");
    await wait_event(mark, selection_is("caret_columns", "f"), "column 5");
    await press_keys("j");
    await wait_event(mark, selection_is("caret_columns", "b"), "the short line");
    const mark_back = events.length;
    await press_keys("j");
    await wait_event(mark_back, selection_is("caret_columns", "f"), "column 5 again on the long line");
    await escape_to_normal("caret_columns");
  });

  await run_case("j keeps the column while the next line is below the screen", async () => {
    await open_page("caret_long_columns", "caret_long", { new_tab: true });
    await press_and_wait_for_move("caret_long", "gV", "the caret on the title");
    await press_and_wait_for_move("caret_long", "j", "j onto the first line");
    const mark_columns = events.length;
    await press_keys("lllll");
    await wait_event(mark_columns, selection_is("caret_long", "f"), "column 5");
    const mark_count = events.length;
    await press_keys("120j");
    await wait_for_last_selection("caret_long", mark_count, (last) => last.scroll_y > 0 && last.text === "f", 'the caret on "f" in column 5 after 120 j, with the page scrolled down');
    await escape_to_normal("caret_long");
  });

  await run_case("the caret scrolls a nested scroller to stay in view", async () => {
    await open_page("caret_nested", "caret_nested", { new_tab: true });
    await press_and_wait_for_move("caret_nested", "gV", "the caret on the title");
    await press_and_wait_for_move("caret_nested", "j", "j onto the first line");
    const mark_count = events.length;
    await press_keys("60j");
    await wait_for_last_selection("caret_nested", mark_count, (last) => last.pane_top > 300 && last.top >= 0 && last.top < 400, "the pane scrolled past 300 with the caret inside it after 60 j");
    await escape_to_normal("caret_nested");
  });

  await run_case("V on a page scrolled into the middle of a paragraph starts on a visible character", async () => {
    await open_page("caret_scrolled", "caret_scrolled", { new_tab: true });
    // The load handler scrolls to 3000. Its report says the scroll is over.
    await poll_until("the page to report its scroll into the paragraph", () => last_scroll_y("caret_scrolled") >= 2500);
    const mark = events.length;
    await press_keys("gV");
    const shown = await wait_event(mark, (event) => event.type === "selection" && event.page_id === "caret_scrolled" && event.text !== "", "a caret");
    expect(shown.top !== null && shown.top > -30 && shown.top < 1000, `the caret starts at y ${shown.top}, off screen`);
    // Starting at the paragraph's first character would scroll the page back up to it.
    expect(shown.scroll_y > 2500, `the page scrolled from y 3000 to ${shown.scroll_y}`);
    await escape_to_normal("caret_scrolled");
  });

  const wait_for_hint_labels = () => poll_until("the hint labels to show", async () => (await hint_label_count()) > 0);
  // A hint starts the mode at its element: label "a" is the only element, so it is picked at once.
  const hint_into = async (page_id, flag, target) => {
    await open_page("caret_hint", page_id, { new_tab: true });
    const mark = events.length;
    await run_line(`:hint ${flag} --custom --selector=${target}`);
    await wait_for_hint_labels();
    await press_keys("a");
    return mark;
  };

  await run_case("hint --caret on a paragraph starts caret mode on its first character", async () => {
    const mark = await hint_into("hint_caret", "--caret", "#pick");
    await wait_event(mark, badge_is("hint_caret", "CARET"), "the CARET badge");
    await wait_event(mark, selection_is("hint_caret", "b"), "the caret on the first character of the paragraph");
    await escape_to_normal("hint_caret");
  });

  await run_case("hint --visual on a paragraph starts visual mode on its first character", async () => {
    const mark = await hint_into("hint_visual", "--visual", "#pick");
    await wait_event(mark, badge_is("hint_visual", "VISUAL"), "the VISUAL badge");
    await wait_event(mark, selection_is("hint_visual", "b"), "one character selected");
    await escape_to_normal("hint_visual");
  });

  await run_case("hint --caret on an image or a field jumps to the next text", async () => {
    const image_mark = await hint_into("hint_image", "--caret", "#pic");
    await wait_event(image_mark, selection_is("hint_image", "g"), "the caret on the text after the image");
    await escape_to_normal("hint_image");
    const field_mark = await hint_into("hint_field", "--caret", "#field");
    await wait_event(field_mark, selection_is("hint_field", "o"), "the caret on the text after the field");
    await escape_to_normal("hint_field");
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
    await expect_absent(mark, "hint_frame", (event) => event.type === "toast" && event.page_id === "hint_frame", "a notice showed");
    await escape_to_normal("hint_frame");
  });

  await run_case(";v and ;V pick a hint for caret and visual mode", async () => {
    await open_page("caret_hint", "hint_keys", { new_tab: true });
    const mark = events.length;
    await press_keys(";v");
    await wait_for_hint_labels();
    await press_keys("a");
    await wait_event(mark, badge_is("hint_keys", "CARET"), "the CARET badge after ;v");
    await escape_to_normal("hint_keys");
    const mark_visual = events.length;
    await press_keys(";V");
    await wait_for_hint_labels();
    await press_keys("a");
    await wait_event(mark_visual, badge_is("hint_keys", "VISUAL"), "the VISUAL badge after ;V");
    await escape_to_normal("hint_keys");
  });

  await run_case("v starts caret mode and V visual mode, with no hint", async () => {
    await open_page("caret", "caret_plain_keys", { new_tab: true });
    const mark = events.length;
    await press_keys("v");
    await wait_event(mark, badge_is("caret_plain_keys", "CARET"), "the CARET badge after v");
    await escape_to_normal("caret_plain_keys");
    const mark_visual = events.length;
    await press_keys("V");
    await wait_event(mark_visual, badge_is("caret_plain_keys", "VISUAL"), "the VISUAL badge after V");
    await escape_to_normal("caret_plain_keys");
  });

  await run_case(";; opens the command line with hint typed, so flags can follow", async () => {
    await open_page("caret_hint", "hint_line", { new_tab: true });
    const mark = events.length;
    await press_keys(";;");
    await wait_cmdline((line) => line.open && line.ready && line.value.startsWith("hint"), "the line to open with hint typed");
    await type_in_line(" --caret --custom --selector=#pick");
    await press_keys("-k", "Return");
    await wait_for_hint_labels();
    await press_keys("a");
    await wait_event(mark, badge_is("hint_line", "CARET"), "the CARET badge from the hint typed into the line");
    await escape_to_normal("hint_line");
  });

  // `s` names no engine, so the default_engine setting decides, and the test config points the built-in duck at the test server.
  await run_case("V, 3w, v, e, s searches the selected word", async () => {
    await open_page("caret", "caret_search", { new_tab: true });
    const mark = events.length;
    await press_and_wait_for_move("caret_search", "gV", "the caret");
    await press_and_wait_for_move("caret_search", "3w", "3w to move the caret");
    const mark_visual = events.length;
    await press_keys("v");
    await wait_event(mark_visual, badge_is("caret_search", "VISUAL"), "the VISUAL badge");
    await press_and_wait_for_move("caret_search", "e", "e to extend the selection");
    await press_keys("s");
    const result = await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "search_result", "the search result page");
    expect(new URLSearchParams(result.search).get("q") === "bar", `searched "${new URLSearchParams(result.search).get("q")}", expected "bar"`);
  });

  // /caret_ft holds forty rows "row N x", 100 pixels apart. The highlights are read from the page's own world, by the names of the character find and of a kept `/` search.
  const READ_FT = `JSON.parse(window.wrappedJSObject.eval(${JSON.stringify(`JSON.stringify((() => {
    const texts = (name) => { const found = []; CSS.highlights.get(name)?.forEach((range) => found.push(range.startContainer.data)); return found; };
    return { all: texts("oasis-ft"), current: texts("oasis-ft-current"), search: texts("oasis-find").length + texts("oasis-find-current").length, y: scrollY };
  })())`)}))`;
  const row_of = (text) => Number(/row (\d+)/.exec(text)?.[1]);
  const lit = (state) => state.all.length + state.current.length;
  async function wait_ft(predicate, what) {
    let state;
    try {
      await poll_until(what, async () => predicate((state = await in_active_tab(READ_FT))));
    } catch (error) {
      throw new Error(`${error.message}, last state ${JSON.stringify(state)}`);
    }
    return state;
  }
  const current_row = (state) => (state.current.length === 1 ? row_of(state.current[0]) : -1);
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  if (shot_dir) mkdirSync(shot_dir, { recursive: true });

  // gV starts on the heading "caret <page id>", and its first paragraph is that heading. f, F, t and T read the next key as the target.
  await run_case("f F t T move to a typed character within the paragraph", async () => {
    await open_page("caret", "caret_find", { new_tab: true });
    await press_and_wait_for_move("caret_find", "gV", "the caret on the heading");
    // The heading is "caret caret_find": the first t is at 4, the underscore at 11 and the second c at 6.
    for (const [keys, text] of [["ft", "t"], ["Fc", "c"], ["t_", "t"], ["Tc", "a"]]) {
      const mark = events.length;
      await press_keys(keys);
      await wait_event(mark, selection_is("caret_find", text), `${keys} to "${text}"`);
      // The find lights its matches and the same key family repeats it, so Escape ends it before the next find.
      await press_keys("-k", "Escape");
      await wait_ft((state) => lit(state) === 0, "Escape to end the find");
    }
    await escape_to_normal("caret_find");
  });

  await run_case("Escape cancels a pending find and stays in caret mode, and a bound key is a target", async () => {
    await open_page("caret", "caret_find_cancel", { new_tab: true });
    await press_and_wait_for_move("caret_find_cancel", "gV", "the caret on the heading");
    // A pending find shows nothing and takes any key as its target, even the barrier key, so Escape goes in the same run as f.
    await press_keys("f", "-k", "Escape");
    let mark = events.length;
    await press_keys("l");
    await wait_event(mark, selection_is("caret_find_cancel", "a"), "l after the cancelled find");
    // w is bound to a word motion, and here it is the target: the heading has no w, so the caret stays and the find is over.
    await press_keys("fw", "-k", "Escape");
    mark = events.length;
    await press_keys("fd");
    await wait_event(mark, selection_is("caret_find_cancel", "d"), "fd after a find with no match");
    await press_keys("-k", "Escape");
    await wait_ft((state) => lit(state) === 0, "Escape to end the find");
  });

  // A space arrives as the token <Space>, longer than one character, and is still a target.
  await run_case("f then Space moves to the first space of the paragraph", async () => {
    await open_page("caret", "caret_find_space", { new_tab: true });
    await press_and_wait_for_move("caret_find_space", "gV", "the caret on the heading");
    const mark = events.length;
    await press_keys("f", " ");
    await wait_event(mark, selection_is("caret_find_space", " "), "f then Space to the space after caret");
    // The first Escape ends the find and keeps caret mode.
    await press_keys("-k", "Escape");
    await wait_ft((state) => lit(state) === 0, "Escape to end the find");
    await escape_to_normal("caret_find_space");
  });

  await run_case("fx lights the visible matches, f and F repeat across the page and scroll it, 3f counts", async () => {
    await open_page("caret_ft", "ft_repeat", { new_tab: true });
    await press_and_wait_for_move("ft_repeat", "gV", "the caret");
    await press_keys("fx");
    const first = await wait_ft((state) => current_row(state) === 0 && lit(state) >= 3, "the matches of the first screen with row 0 current");
    expect(lit(first) < 25, `lit ${lit(first)} matches of forty rows: only the visible ones and a screen around should be lit`);
    expect(first.y === 0, `the first f scrolled to ${first.y}`);
    if (shot_dir) await take_shot(`${shot_dir}/char-find-highlights.png`);
    await press_keys("3f");
    await wait_ft((state) => current_row(state) === 3, "3f to row 3");
    // Far past the first screen: the page scrolls and the new screen is lit, with the neighbours of the current row.
    for (let step = 1; step < 14; step++) {
      await press_keys("f");
      await wait_ft((state) => current_row(state) === 3 + step, `f to row ${3 + step}`);
    }
    await press_keys("f");
    const far = await wait_ft((state) => current_row(state) === 17 && state.y > 0, "row 17 current after the page scrolled");
    expect(far.all.some((text) => row_of(text) === 16) || far.all.some((text) => row_of(text) === 18), `the new screen is not lit: ${JSON.stringify(far)}`);
    await press_keys("F");
    await wait_ft((state) => current_row(state) === 16, "F back to row 16");
    await press_keys("-k", "Escape");
    await wait_ft((state) => lit(state) === 0, "Escape to end the find");
  });

  await run_case("t after f starts a till find, and the match next to the caret is the current one", async () => {
    await open_page("caret_ft", "ft_till", { new_tab: true });
    await press_and_wait_for_move("ft_till", "gV", "the caret");
    await press_keys("fx");
    await wait_ft((state) => current_row(state) === 0, "row 0 current");
    await press_keys("t");
    await wait_ft((state) => lit(state) === 0, "no highlights while the till find waits for its target");
    await press_keys("x");
    await wait_ft((state) => current_row(state) === 1, "the x of row 1 current after tx");
    await press_keys("t");
    await wait_ft((state) => current_row(state) === 2, "t repeats the till find to row 2");
    await press_keys("T");
    await wait_ft((state) => current_row(state) === 1, "T repeats it back to row 1");
    await press_keys("-k", "Escape");
    await wait_ft((state) => lit(state) === 0, "Escape to end the find");
  });

  await run_case("another key, Escape and a mode change clear the highlights, and ; repeats without them", async () => {
    await open_page("caret_ft", "ft_end", { new_tab: true });
    await press_and_wait_for_move("ft_end", "gV", "the caret");
    await press_keys("fx");
    await wait_ft((state) => current_row(state) === 0, "row 0 current");
    await press_keys("l");
    await wait_ft((state) => lit(state) === 0, "cleared by l");
    // ; repeats the find, so the caret moves, and the barrier then holds the page back until any highlight would be drawn.
    const mark_repeat = events.length;
    await press_keys(";");
    await wait_event(mark_repeat, is_selection_of("ft_end"), "; to repeat the find");
    await barrier("ft_end");
    expect(lit(await in_active_tab(READ_FT)) === 0, "; after the end drew highlights");
    await press_keys("fx");
    await wait_ft((state) => lit(state) > 0, "lit again by a new find");
    await press_keys("-k", "Escape");
    await wait_ft((state) => lit(state) === 0, "cleared by Escape");
    await press_keys("fx");
    await wait_ft((state) => lit(state) > 0, "lit once more");
    await press_keys("v");
    await wait_ft((state) => lit(state) === 0, "cleared by a mode change to visual");
    await escape_to_normal("ft_end");
  });

  await run_case("scrolling the page moves the highlights while the find is live and stops when it ends", async () => {
    await open_page("caret_ft", "ft_scroll", { new_tab: true });
    await press_and_wait_for_move("ft_scroll", "gV", "the caret");
    await press_keys("fx");
    await wait_ft((state) => current_row(state) === 0, "row 0 current");
    await in_active_tab("window.scrollTo(0, 2400); 0");
    await wait_ft((state) => state.all.some((text) => row_of(text) >= 22), "highlights on the scrolled screen");
    await press_keys("l");
    await wait_ft((state) => lit(state) === 0, "cleared by l");
    // The page reports a scroll 150 ms after it ends, and a highlight would be drawn before that.
    const mark_scroll = events.length;
    await in_active_tab("window.scrollTo(0, 0); 0");
    await wait_event(mark_scroll, (event) => scroll_of("ft_scroll")(event) && event.y === 0, "the scroll back to the top");
    expect(lit(await in_active_tab(READ_FT)) === 0, "a scroll after the end drew highlights");
    await escape_to_normal("ft_scroll");
  });

  await run_case("a kept / search stays lit through a character find and after it ends", async () => {
    await open_page("caret_ft", "ft_search", { new_tab: true });
    await press_keys("/row 3");
    await wait_cmdline((line) => line.open && line.value === "row 3", "the search line to hold row 3");
    await press_keys("-k", "Return");
    const kept = await wait_ft((state) => state.search > 0, "the kept search highlights");
    await press_and_wait_for_move("ft_search", "gV", "the caret");
    await press_keys("fx");
    await wait_ft((state) => lit(state) > 0 && state.search === kept.search, "both sets lit");
    await press_keys("l");
    const after = await wait_ft((state) => lit(state) === 0, "the character find cleared");
    expect(after.search === kept.search, `the kept search lost highlights: ${kept.search} then ${after.search}`);
    await escape_to_normal("ft_search");
  });
}
