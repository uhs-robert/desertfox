// Key cases of the caret and visual piece. run.mjs calls run_cases with its helpers.
// The pages report each change of their selection, and the highlight style the bundle puts on the document.

export async function run_cases({ run_case, expect, open_page, send_keys, sleep, events, wait_event }) {
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];
  // Moonlight, the default palette, dark: the caret takes the command color and visual mode the visual color.
  const CARET_BACKGROUND = "#7fcf78";
  const VISUAL_BACKGROUND = "#ffba75";

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
}
