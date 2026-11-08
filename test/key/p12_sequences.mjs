// Key test cases of array bindings (awaitable commands, routing). The harness calls run_cases with the piece context.
// The bindings live in config/keymap.toml: ,n = [tab.next, scroll.to 0], ,h = [hint.run background, scroll 300],
// ,f = [find.next, scroll 300], ,o = [cmdline.open, scroll 300], ,p = [:scroll.pixels, scroll 300], ,t = [hint.run background, tab.next].

export const areas = ["keys", "tabs", "hints", "find", "cmdline", "scroll"];

export async function run_cases({ close_tabs_with, run_case, press_keys, poll_until, settle_focus, settle_tab_switch, expect_absent, hint_label_count, close_cmdline, wait_cmdline, scroll_report_wait_ms, open_page, wait_event, find_event, events, expect, sleep, became_visible, scroll_delta_by_press, scroll_of, last_scroll_y }) {
  const ENTER = ["-k", "Return"];
  const ESCAPE = ["-k", "Escape"];
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const became_any_visible = (event) => event.type === "visibility" && event.state === "visible";
  const wait_for_labels = (what) => poll_until(`the hint labels after ${what}`, async () => (await hint_label_count()) > 0);
  const wait_for_no_labels = (what) => poll_until(`the hint labels to go after ${what}`, async () => (await hint_label_count()) === 0);
  // A second Escape closes the completion list if the first one only closed that. Then j must reach the page, which it cannot if the line is still open.
  const expect_line_closed = async (page_id) => {
    await close_cmdline();
    expect(await scroll_delta_by_press(page_id, ["j"]) > 0, "j did not scroll the page, so the command line is still open");
  };
  // The step after a waiting step runs at once when the sequence is wrong, and the page reports its scroll or tab switch within this time.
  const let_a_wrong_step_show = () => sleep(scroll_report_wait_ms);

  await run_case("[tab.next, scroll.to] scrolls the tab that tab.next showed, and leaves the first tab alone", async () => {
    await open_page("page", "sq_one", { new_tab: true });
    await open_page("page", "sq_two", { new_tab: true });
    let mark = events.length;
    await press_keys("G");
    await wait_event(mark, scroll_of("sq_two"), "sq_two to scroll to the bottom");
    expect(last_scroll_y("sq_two") > 0, "sq_two did not scroll down");
    mark = events.length;
    await press_keys("gT");
    await wait_event(mark, became_visible("sq_one"), "sq_one after gT");
    await settle_tab_switch();
    mark = events.length;
    await press_keys(",n");
    await wait_event(mark, became_visible("sq_two"), "sq_two after ,n");
    await wait_event(mark, (event) => scroll_of("sq_two")(event) && event.y === 0, "sq_two to scroll to the top");
    await settle_tab_switch();
    await expect_absent(mark, "sq_two", scroll_of("sq_one"), "the first tab scrolled", { report_delay_ms: scroll_report_wait_ms });
    await close_tabs_with("sq_");
  });

  await run_case("[hint.run, scroll]: a pick resumes the sequence, Escape cancels the rest", async () => {
    await open_page("hints", "sq_hints", { new_tab: true });
    let mark = events.length;
    await press_keys(",h");
    await wait_for_labels(",h");
    await let_a_wrong_step_show();
    expect(!find_event(mark, scroll_of("sq_hints")), "the page scrolled while the hint labels were up");
    await press_keys("s");
    await wait_event(mark, scroll_of("sq_hints"), "the scroll after the hint pick");
    await wait_event(mark, loaded("hint_two"), "the picked link to load in a background tab");
    await close_tabs_with("hint_two");
    await settle_focus();
    // The scroll step moved the links off screen, where they get no label. Back at the top the labels show, so Escape has something to cancel.
    await scroll_delta_by_press("sq_hints", ["gg"]);
    mark = events.length;
    await press_keys(",h");
    await wait_for_labels(",h again");
    await press_keys(...ESCAPE);
    await wait_for_no_labels("Escape");
    await expect_absent(mark, "sq_hints", scroll_of("sq_hints"), "the page scrolled after Escape left the hints", { report_delay_ms: scroll_report_wait_ms });
    await close_tabs_with("sq_hints");
  });

  await run_case("[find.next, scroll] with no earlier search stops after the failure", async () => {
    await open_page("page", "sq_find", { new_tab: true });
    const mark = events.length;
    await press_keys(",f");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "sq_find", "the failure notice of find.next");
    await expect_absent(mark, "sq_find", scroll_of("sq_find"), "the page scrolled after find.next failed", { report_delay_ms: scroll_report_wait_ms });
    await close_tabs_with("sq_find");
  });

  await run_case("[cmdline.open, scroll]: the page does not scroll behind the open line, Enter resumes, Escape cancels", async () => {
    await open_page("page", "sq_line", { new_tab: true });
    let mark = events.length;
    await press_keys(",o");
    await wait_cmdline((line) => line.open, "the command line to open after ,o");
    await let_a_wrong_step_show();
    expect(!find_event(mark, scroll_of("sq_line")), "the page scrolled behind the open command line");
    await press_keys("scroll.pixels --dy=0", ...ENTER);
    await wait_event(mark, scroll_of("sq_line"), "the scroll after Enter");
    mark = events.length;
    await press_keys(",o");
    await wait_cmdline((line) => line.open, "the command line to open after ,o again");
    await close_cmdline();
    await expect_absent(mark, "sq_line", scroll_of("sq_line"), "the page scrolled after Escape closed the line", { report_delay_ms: scroll_report_wait_ms });
    await expect_line_closed("sq_line");
    await close_tabs_with("sq_line");
  });

  await run_case("[:scroll.pixels, scroll]: a prompt step holds the scroll, Enter resumes, Escape cancels", async () => {
    await open_page("page", "sq_prompt", { new_tab: true });
    let mark = events.length;
    await press_keys(",p");
    await wait_cmdline((line) => line.open, "the prompt to open after ,p");
    await let_a_wrong_step_show();
    expect(!find_event(mark, scroll_of("sq_prompt")), "the page scrolled while the prompt was open");
    await press_keys("0", ...ENTER);
    await wait_event(mark, (event) => scroll_of("sq_prompt")(event) && event.y >= 300, "the second step (scroll down 300) after Enter on a line that scrolls right by 0");
    await close_tabs_with("sq_prompt");
    await open_page("page", "sq_prompt2", { new_tab: true });
    mark = events.length;
    await press_keys(",p");
    await wait_cmdline((line) => line.open, "the prompt to open after ,p again");
    await close_cmdline();
    await expect_absent(mark, "sq_prompt2", scroll_of("sq_prompt2"), "the page scrolled after Escape closed the prompt", { report_delay_ms: scroll_report_wait_ms });
    await expect_line_closed("sq_prompt2");
    await close_tabs_with("sq_prompt2");
  });

  await run_case("[hint.run, tab.next]: a pick switches tab, Escape does not", async () => {
    await open_page("hints", "sq_tabhint", { new_tab: true });
    let mark = events.length;
    await press_keys(",t");
    await wait_for_labels(",t");
    await let_a_wrong_step_show();
    expect(!find_event(mark, became_any_visible), "a tab switched while the hint labels were up");
    await press_keys("s");
    await wait_event(mark, (event) => became_any_visible(event) && event.page_id !== "sq_tabhint", "another tab after the hint pick");
    await close_tabs_with("hint_two");
    await close_tabs_with("sq_tabhint");
    await open_page("hints", "sq_tabhint2", { new_tab: true });
    mark = events.length;
    await press_keys(",t");
    await wait_for_labels(",t again");
    await press_keys(...ESCAPE);
    await wait_for_no_labels("Escape");
    await expect_absent(mark, "sq_tabhint2", became_any_visible, "a tab switched after Escape left the hints");
    await close_tabs_with("sq_tabhint2");
  });
}
