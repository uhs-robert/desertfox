// Snippets from test/key/config/snippets: the default arg, the match limit, error and depth toasts, and the top frame only.
// A toast has a cooldown, so each case that expects a toast first waits for the toast before it to leave.

export const areas = ["config"];

export async function run_cases({ run_case, setup, expect, open_page, press_keys, poll_until, barrier, expect_absent, events, wait_event, since, scroll_of }) {
  const snippet_events = (mark, type) => since(mark).filter((event) => event.type === type);
  // The reporter sends "toast" when the host appears and "toast_gone" when it leaves, so the last of the two says whether one shows.
  const toast_shows = (page_id) => events.findLast((event) => event.page_id === page_id && (event.type === "toast" || event.type === "toast_gone"))?.type === "toast";
  const wait_toast_gone = (page_id) => poll_until("the toast before to leave", () => !toast_shows(page_id), { timeout_ms: 8000 });
  await setup("open page snip", () => open_page("page", "snip", { new_tab: true }));

  await run_case("a snippet runs on a matching page, in the top frame, with its default arg", async () => {
    const mark = events.length;
    await press_keys(",s");
    const ran = await wait_event(mark, (event) => event.type === "snippet_ran" && event.page_id === "snip", "the snippet report");
    expect(ran.word === "hi" && ran.top === true, `snippet reported word=${ran.word} top=${ran.top}`);
  });

  await run_case("a snippet limited to another site does not run here", async () => {
    const mark = events.length;
    await press_keys(",x");
    // The refusal toast shows that the key reached the snippet, and the barrier that nothing else followed it.
    await wait_event(mark, (event) => event.type === "toast", "the refusal toast");
    await expect_absent(mark, "snip", (event) => event.type === "snippet_wrong_site", "the snippet ran on a site its matches do not name");
  });

  await run_case("an error in a snippet shows a toast and keys keep working", async () => {
    await wait_toast_gone("snip");
    const mark = events.length;
    await press_keys(",e");
    await wait_event(mark, (event) => event.type === "toast", "the error toast");
    const scroll_mark = events.length;
    await press_keys("j");
    const scrolled = await wait_event(scroll_mark, scroll_of("snip"), "j to scroll after the snippet error");
    expect(scrolled.y > 0, "j did not scroll after the snippet error");
  });

  await run_case("a snippet that calls itself stops after 5 levels with a toast", async () => {
    await wait_toast_gone("snip");
    const mark = events.length;
    await press_keys(",l");
    await wait_event(mark, (event) => event.type === "toast", "the depth limit toast");
    // A sixth level would report after the toast, so the barrier comes before the count.
    await barrier("snip");
    const levels = snippet_events(mark, "snippet_level").length;
    expect(levels === 5, `the looping snippet ran ${levels} times`);
  });

  await run_case("a snippet key pressed inside an iframe runs in the top frame only", async () => {
    const focus_mark = events.length;
    await open_page("framed", "framed", { new_tab: true });
    await wait_event(focus_mark, (event) => event.type === "window_focus" && event.page_id === "inner", "the iframe to take focus");
    const mark = events.length;
    await press_keys(",s");
    await wait_event(mark, (event) => event.type === "snippet_ran" && event.page_id === "framed", "the snippet report from the top frame");
    // The keys go to the focused iframe, so its page reports the barrier key.
    await expect_absent(mark, "inner", (event) => event.type === "snippet_ran" && (event.page_id === "inner" || event.top !== true), "the snippet ran inside the iframe");
  });
}
