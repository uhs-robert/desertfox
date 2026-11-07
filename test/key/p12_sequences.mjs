// Key test cases of array bindings (awaitable commands, routing). The harness calls run_cases with the piece context.
// The bindings live in config/keymap.toml: ,n = [tab.next, scroll.to 0], ,h = [hint.run background, scroll 300],
// ,f = [find.next, scroll 300], ,o = [cmdline.open, scroll 300], ,p = [:scroll.pixels, scroll 300], ,t = [hint.run background, tab.next].

export async function run_cases({ close_tabs_with, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, became_visible, scroll_delta_after, scroll_of, last_scroll_y }) {
  const ENTER = ["-k", "Return"];
  const ESCAPE = ["-k", "Escape"];
  // A second Escape closes the completion list if the first one only closed that. Then j must reach the page, which it cannot if the line is still open.
  const expect_line_closed = async (page_id) => {
    await send_keys(...ESCAPE);
    await sleep(300);
    expect(await scroll_delta_after(page_id, ["j"]) > 0, "j did not scroll the page, so the command line is still open");
  };

  await run_case("[tab.next, scroll.to] scrolls the tab that tab.next showed, and leaves the first tab alone", async () => {
    await open_page("page", "sq_one", { new_tab: true });
    await open_page("page", "sq_two", { new_tab: true });
    let mark = events.length;
    await send_keys("G");
    await wait_event(mark, scroll_of("sq_two"), "sq_two to scroll to the bottom");
    expect(last_scroll_y("sq_two") > 0, "sq_two did not scroll down");
    mark = events.length;
    await send_keys("gT");
    await wait_event(mark, became_visible("sq_one"), "sq_one after gT");
    await sleep(300);
    mark = events.length;
    await send_keys(",n");
    await wait_event(mark, became_visible("sq_two"), "sq_two after ,n");
    await wait_event(mark, (event) => scroll_of("sq_two")(event) && event.y === 0, "sq_two to scroll to the top");
    expect(!find_event(mark, scroll_of("sq_one")), "the first tab scrolled");
    await close_tabs_with("sq_");
    await sleep(300);
  });

  await run_case("[hint.run, scroll]: a pick resumes the sequence, Escape cancels the rest", async () => {
    await open_page("hints", "sq_hints", { new_tab: true });
    let mark = events.length;
    await send_keys(",h");
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_hints")), "the page scrolled while the hint labels were up");
    await send_keys("s");
    await wait_event(mark, scroll_of("sq_hints"), "the scroll after the hint pick");
    await sleep(500);
    await close_tabs_with("hint_two");
    mark = events.length;
    await send_keys(",h");
    await sleep(700);
    await send_keys(...ESCAPE);
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_hints")), "the page scrolled after Escape left the hints");
    await close_tabs_with("sq_hints");
    await sleep(300);
  });

  await run_case("[find.next, scroll] with no earlier search stops after the failure", async () => {
    await open_page("page", "sq_find", { new_tab: true });
    const mark = events.length;
    await send_keys(",f");
    await sleep(1000);
    expect(!find_event(mark, scroll_of("sq_find")), "the page scrolled after find.next failed");
    await close_tabs_with("sq_find");
    await sleep(300);
  });

  await run_case("[cmdline.open, scroll]: the page does not scroll behind the open line, Enter resumes, Escape cancels", async () => {
    await open_page("page", "sq_line", { new_tab: true });
    let mark = events.length;
    await send_keys(",o");
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_line")), "the page scrolled behind the open command line");
    await send_keys("scroll.pixels --dy=0", ...ENTER);
    await wait_event(mark, scroll_of("sq_line"), "the scroll after Enter");
    mark = events.length;
    await send_keys(",o");
    await sleep(700);
    await send_keys(...ESCAPE);
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_line")), "the page scrolled after Escape closed the line");
    await expect_line_closed("sq_line");
    await close_tabs_with("sq_line");
    await sleep(300);
  });

  await run_case("[:scroll.pixels, scroll]: a prompt step holds the scroll, Enter resumes, Escape cancels", async () => {
    await open_page("page", "sq_prompt", { new_tab: true });
    let mark = events.length;
    await send_keys(",p");
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_prompt")), "the page scrolled while the prompt was open");
    await send_keys("0", ...ENTER);
    await wait_event(mark, (event) => scroll_of("sq_prompt")(event) && event.y >= 300, "the second step (scroll down 300) after Enter on a line that scrolls right by 0");
    await close_tabs_with("sq_prompt");
    await sleep(500);
    await open_page("page", "sq_prompt2", { new_tab: true });
    mark = events.length;
    await send_keys(",p");
    await sleep(700);
    await send_keys(...ESCAPE);
    await sleep(700);
    expect(!find_event(mark, scroll_of("sq_prompt2")), "the page scrolled after Escape closed the prompt");
    await expect_line_closed("sq_prompt2");
    await close_tabs_with("sq_prompt2");
    await sleep(300);
  });

  await run_case("[hint.run, tab.next]: a pick switches tab, Escape does not", async () => {
    await open_page("hints", "sq_tabhint", { new_tab: true });
    let mark = events.length;
    await send_keys(",t");
    await sleep(700);
    expect(!find_event(mark, (event) => event.type === "visibility" && event.state === "visible"), "a tab switched while the hint labels were up");
    await send_keys("s");
    await wait_event(mark, (event) => event.type === "visibility" && event.state === "visible" && event.page_id !== "sq_tabhint", "another tab after the hint pick");
    await close_tabs_with("hint_two");
    await close_tabs_with("sq_tabhint");
    await sleep(500);
    await open_page("hints", "sq_tabhint2", { new_tab: true });
    mark = events.length;
    await send_keys(",t");
    await sleep(700);
    await send_keys(...ESCAPE);
    await sleep(700);
    expect(!find_event(mark, (event) => event.type === "visibility" && event.state === "visible"), "a tab switched after Escape left the hints");
    await close_tabs_with("sq_tabhint2");
    await sleep(300);
  });
}
