// The one-shot normal prefix <A-o> (`mode.normal_once`): the next sequence runs as a normal command in a field and in ignore mode, the badge shows NORMAL while it waits, the which-key panel opens at once, and Escape only drops it.

import { ALT, SHIFT_ESCAPE } from "./harness.mjs";

export const areas = ["keys", "whichkey"];

export async function run_cases({ run_case, open_page, press_keys, wait_event, wait_takes_keys, events, expect, expect_no_scroll, poll_until, scroll_of, in_active_tab }) {
  const wait_badge = (mark, page_id, label) => wait_event(mark, (event) => event.type === "indicator" && event.page_id === page_id && event.label === label, `${label} on ${page_id}`);
  const page_sees = (mark, page_id, key) => wait_event(mark, (event) => event.type === "keydown" && event.key === key && event.page_id === page_id, `${page_id} to see ${key}`);
  const field_value = () => in_active_tab(`document.getElementById("p57_input").value`);
  const open_with_field = async (page_id) => {
    await open_page("page", page_id, { new_tab: true });
    await in_active_tab(`document.body.insertAdjacentHTML("afterbegin", '<input id="p57_input">'); 0`);
    const mark = events.length;
    await in_active_tab(`document.getElementById("p57_input").focus(); 0`);
    await wait_badge(mark, page_id, "INSERT");
    await wait_takes_keys(page_id);
  };

  await run_case("in a field, Alt+O then G scrolls as normal mode, and typing goes on in the field", async () => {
    await open_with_field("p57_field");
    await press_keys("a");
    await poll_until("the field to hold a", async () => (await field_value()) === "a");
    let mark = events.length;
    await press_keys(...ALT("o"));
    await wait_badge(mark, "p57_field", "NORMAL");
    // The panel lists the normal keys at once, with no prefix typed.
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p57_field" && event.value !== "", "the which-key panel at once");
    mark = events.length;
    await press_keys("G");
    await wait_event(mark, scroll_of("p57_field"), "G to scroll the page");
    await wait_badge(mark, "p57_field", "INSERT");
    await press_keys("b");
    await poll_until("the field to hold ab", async () => (await field_value()) === "ab");
    expect((await in_active_tab(`document.activeElement?.id`)) === "p57_input", "the field lost the focus");
  });

  await run_case("in a field, Alt+O then Escape only drops the prefix, and the next key types", async () => {
    await open_with_field("p57_escape");
    let mark = events.length;
    await press_keys(...ALT("o"));
    await wait_badge(mark, "p57_escape", "NORMAL");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p57_escape", "INSERT");
    mark = events.length;
    await press_keys("j");
    await poll_until("the field to hold j", async () => (await field_value()) === "j");
    await expect_no_scroll(mark, "p57_escape");
  });

  await run_case("in ignore mode, Alt+O then G scrolls once, and the page gets keys again after it", async () => {
    await open_page("page", "p57_ignore", { new_tab: true });
    let mark = events.length;
    await press_keys(...SHIFT_ESCAPE);
    await wait_badge(mark, "p57_ignore", "IGNORE");
    mark = events.length;
    await press_keys(...ALT("o"));
    await wait_badge(mark, "p57_ignore", "NORMAL");
    mark = events.length;
    await press_keys("G");
    await wait_event(mark, scroll_of("p57_ignore"), "G to scroll the page");
    await wait_badge(mark, "p57_ignore", "IGNORE");
    mark = events.length;
    await press_keys("k");
    await page_sees(mark, "p57_ignore", "k");
    await expect_no_scroll(mark, "p57_ignore");
  });

  await run_case("in a field, Alt+O then v opens caret mode, and its Escape puts the focus back in the field", async () => {
    await open_with_field("p57_caret");
    let mark = events.length;
    await press_keys(...ALT("o"), "v");
    await wait_badge(mark, "p57_caret", "CARET");
    mark = events.length;
    await press_keys("-k", "Escape");
    await poll_until("the field to hold the focus again", async () => (await in_active_tab(`document.activeElement?.id`)) === "p57_input");
    await wait_badge(mark, "p57_caret", "INSERT");
  });
}
