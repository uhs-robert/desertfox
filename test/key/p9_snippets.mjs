// Snippets from test/key/config/snippets: the default arg, the match limit, error and depth toasts, and the top frame only.
// The 3.5 s sleeps wait out the toast cooldown, so a toast from the case before cannot stand in for the next one.

export const areas = ["config"];

export async function run_cases({ run_case, setup, expect, open_page, send_keys, sleep, events, wait_event, since, find_event, scroll_delta_after }) {
  const snippet_events = (mark, type) => since(mark).filter((event) => event.type === type);
  await setup("open page snip", () => open_page("page", "snip", { new_tab: true }));

  await run_case("a snippet runs on a matching page, in the top frame, with its default arg", async () => {
    const mark = events.length;
    await send_keys(",s");
    const ran = await wait_event(mark, (event) => event.type === "snippet_ran" && event.page_id === "snip", "the snippet report");
    expect(ran.word === "hi" && ran.top === true, `snippet reported word=${ran.word} top=${ran.top}`);
  });

  await run_case("a snippet limited to another site does not run here", async () => {
    const mark = events.length;
    await send_keys(",x");
    await sleep(1000);
    expect(snippet_events(mark, "snippet_wrong_site").length === 0, "the snippet ran on a site its matches do not name");
    expect(find_event(mark, (event) => event.type === "toast"), "no toast for the refusal");
  });

  await run_case("an error in a snippet shows a toast and keys keep working", async () => {
    await sleep(3500);
    const mark = events.length;
    await send_keys(",e");
    await wait_event(mark, (event) => event.type === "toast", "the error toast");
    expect(await scroll_delta_after("snip", ["j"]) > 0, "j did not scroll after the snippet error");
  });

  await run_case("a snippet that calls itself stops after 5 levels with a toast", async () => {
    await sleep(3500);
    const mark = events.length;
    await send_keys(",l");
    await wait_event(mark, (event) => event.type === "toast", "the depth limit toast");
    await sleep(500);
    const levels = snippet_events(mark, "snippet_level").length;
    expect(levels === 5, `the looping snippet ran ${levels} times`);
  });

  await run_case("a snippet key pressed inside an iframe runs in the top frame only", async () => {
    const focus_mark = events.length;
    await open_page("framed", "framed", { new_tab: true });
    await wait_event(focus_mark, (event) => event.type === "window_focus" && event.page_id === "inner", "the iframe to take focus");
    const mark = events.length;
    await send_keys(",s");
    await wait_event(mark, (event) => event.type === "snippet_ran" && event.page_id === "framed", "the snippet report from the top frame");
    await sleep(500);
    const in_frame = snippet_events(mark, "snippet_ran").filter((event) => event.page_id === "inner" || event.top !== true);
    expect(in_frame.length === 0, "the snippet ran inside the iframe");
  });
}
