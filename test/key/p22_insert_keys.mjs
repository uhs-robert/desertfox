// i enters insert mode with no field focused, so the page gets every unbound key, and Escape returns to normal mode. I focuses the first field like gi. A child frame takes the same path.

export const areas = ["keys"];

export async function run_cases({ run_case, open_page, press_keys, wait_event, events, expect, expect_no_scroll, poll_until, scroll_delta_by_press, in_active_tab }) {
  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  const wait_badge = (mark, page_id, label) => wait_event(mark, (event) => event.type === "indicator" && event.page_id === page_id && event.label === label, `${label} on ${page_id}`);
  const page_sees = async (mark, page_id, key) => wait_event(mark, (event) => event.type === "keydown" && event.key === key && event.page_id === page_id, `${page_id} to see ${key}`);

  await run_case("i switches to insert mode with no field, the page sees j and G, and Escape returns to normal", async () => {
    await open_page("page", "p22_insert", { new_tab: true });
    let mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_insert", "INSERT");
    mark = events.length;
    await press_keys("j", "G");
    await page_sees(mark, "p22_insert", "j");
    await page_sees(mark, "p22_insert", "G");
    await expect_no_scroll(mark, "p22_insert");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p22_insert", "NORMAL");
    expect((await scroll_delta_by_press("p22_insert", ["G"])) > 0, "G did not scroll after Escape left insert mode");
  });

  await run_case("I focuses the first field and enters insert mode", async () => {
    await open_page("page", "p22_field", { new_tab: true });
    await in_active_tab(`document.body.insertAdjacentHTML("afterbegin", '<input id="p22_input">'); 0`);
    const mark = events.length;
    await press_keys("I");
    await wait_badge(mark, "p22_field", "INSERT");
    expect(await in_active_tab(`document.activeElement.id`) === "p22_input", "I did not focus the first field");
  });

  await run_case("i in a child frame lets that frame see its keys, and Escape ends it", async () => {
    await open_page("frames", "p22_frames", { new_tab: true });
    await wait_event(0, (event) => event.type === "tree_read" && event.page_id === "p22_frames_same", "the same-origin frame to start");
    let mark = events.length;
    await press_keys(";f");
    await poll_until("the hint labels", async () => events.length > mark);
    await press_keys("a");
    await wait_event(mark, (event) => event.type === "window_focus" && event.page_id === "p22_frames_same", "the frame to take the focus");
    mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_frames_same", "INSERT");
    mark = events.length;
    await press_keys("j");
    await page_sees(mark, "p22_frames_same", "j");
    await expect_no_scroll(mark, "p22_frames_same");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p22_frames_same", "NORMAL");
    expect(badge_of("p22_frames_same") === "NORMAL", "the frame did not return to normal mode");
  });
}
