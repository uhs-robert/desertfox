// The core keys: tab switching, scrolling, ignore mode, typing in a field, chords on pages that cancel keys, and the focus_page chord.
// Tab order is a, b, c, then f, s and the about: page as each step opens them. The wrap cases rely on a being first.
import { ALT, CTRL, SHIFT_ESCAPE } from "./harness.mjs";

export const areas = ["scroll", "tabs", "keys"];

export async function run_cases({ run_case, setup, expect, open_page, send_keys, sleep, events, wait_event, since, find_event, scroll_delta_after, became_visible, scroll_of, last_scroll_y, expect_no_scroll, expect_exactly_one_visible, record }) {
  await setup("open pages a, b and c", async () => {
    await open_page("page", "a", { new_tab: false });
    await open_page("page", "b", { new_tab: true });
    await open_page("page", "c", { new_tab: true });
  });

  await run_case("J and K switch tabs", async () => {
    for (const [keys, expected] of [["K", "b"], ["K", "a"], ["J", "b"], ["J", "c"]]) {
      const mark = events.length;
      await send_keys(keys);
      await wait_event(mark, became_visible(expected), `tab ${expected} after ${keys}`);
    }
  });

  await run_case("j scrolls, 3j scrolls three times as far", async () => {
    const single_j_pixels = await scroll_delta_after("c", ["j"]);
    expect(single_j_pixels > 0, "j did not scroll down");
    const triple = await scroll_delta_after("c", ["3j"]);
    expect(Math.abs(triple - 3 * single_j_pixels) <= 3, `3j moved ${triple}px, j moved ${single_j_pixels}px`);
  }, { setup: true });

  await run_case("G jumps to the bottom and gg to the top", async () => {
    await scroll_delta_after("c", ["G"]);
    const bottom = events.filter(scroll_of("c")).at(-1);
    expect(bottom.y >= bottom.max_y - 2, `G stopped at ${bottom.y} of ${bottom.max_y}`);
    await scroll_delta_after("c", ["gg"]);
    expect(last_scroll_y("c") === 0, `gg stopped at ${last_scroll_y("c")}`);
  });

  await run_case("ignore mode passes keys to the page and leaves again", async () => {
    await send_keys(...SHIFT_ESCAPE);
    await sleep(300);
    let mark = events.length;
    await send_keys("j");
    await wait_event(mark, (event) => event.type === "keydown" && event.key === "j", "the page to see j in ignore mode");
    await expect_no_scroll(mark, "c");
    await send_keys(...SHIFT_ESCAPE);
    await sleep(300);
    mark = events.length;
    await send_keys("j");
    await wait_event(mark, scroll_of("c"), "scroll after leaving ignore mode");
    expect(!find_event(mark, (event) => event.type === "keydown" && event.key === "j"), "the page saw j in normal mode");
  });

  await run_case("the mode badge shows NORMAL, then IGNORE, then NORMAL", async () => {
    const is_label = (label) => (event) => event.type === "indicator" && event.page_id === "c" && event.label === label;
    expect(events.some(is_label("NORMAL")), "no NORMAL badge at start");
    let mark = events.length;
    await send_keys(...SHIFT_ESCAPE);
    await wait_event(mark, is_label("IGNORE"), "the IGNORE badge");
    mark = events.length;
    await send_keys(...SHIFT_ESCAPE);
    await wait_event(mark, is_label("NORMAL"), "the NORMAL badge after leaving ignore");
  });

  await setup("open the field page f", () => open_page("field", "f", { new_tab: true }));
  await run_case("typing in a field is not swallowed", async () => {
    const typed = "jkxGddqrgg 3j";
    const mark = events.length;
    await send_keys(typed);
    await sleep(800);
    const inputs = since(mark).filter((event) => event.type === "input");
    expect(inputs.at(-1)?.value === typed, `field holds "${inputs.at(-1)?.value}", typed "${typed}"`);
    expect(!find_event(mark, (event) => event.type === "visibility"), "a tab switch happened while typing");
  });

  await run_case("Escape leaves the field and keys act again", async () => {
    await send_keys("-k", "Escape");
    await sleep(300);
    const mark = events.length;
    await send_keys("K");
    await wait_event(mark, became_visible("c"), "tab c after K");
    await send_keys("J");
    await wait_event(mark, became_visible("f"), "tab f after J");
  });

  await setup("open the key-cancelling page s", () => open_page("swallow", "s", { new_tab: true }));
  await run_case("J and K work on a page that cancels keys in its own capture listener", async () => {
    let mark = events.length;
    await send_keys("K");
    await wait_event(mark, became_visible("f"), "tab f after K");
    await send_keys("J");
    await wait_event(mark, became_visible("s"), "tab s after J");
  });

  await run_case("chord on a cancelling page acts exactly once", async () => {
    let mark = events.length;
    await send_keys(...ALT("j"));
    await expect_exactly_one_visible(mark, "a");
    mark = events.length;
    await send_keys(...ALT("k"));
    await expect_exactly_one_visible(mark, "s");
  });

  await run_case("chord on a normal page acts exactly once", async () => {
    await send_keys("gg");
    await send_keys("K");
    await sleep(500);
    let mark = events.length;
    await send_keys(...ALT("k"));
    await expect_exactly_one_visible(mark, "c");
    mark = events.length;
    await send_keys(...ALT("j"));
    await expect_exactly_one_visible(mark, "f");
  });

  await setup("open about:support", async () => {
    await send_keys(...CTRL("t"));
    await send_keys(...CTRL("l"), "about:support", "-k", "Return");
    await sleep(1500);
  });

  await run_case("Alt+J and Alt+K work on an about: page", async () => {
    let mark = events.length;
    await send_keys(...ALT("k"));
    await expect_exactly_one_visible(mark, "s");
    await send_keys(...ALT("j"));
    await sleep(500);
    mark = events.length;
    await send_keys(...ALT("j"));
    await expect_exactly_one_visible(mark, "a");
  }, { setup: true });

  await run_case("focus_page from the address bar returns keys to the page", async () => {
    const before = last_scroll_y("a");
    const mark = events.length;
    await send_keys(...CTRL("l"));
    await sleep(300);
    await send_keys(...ALT(","));
    await sleep(700);
    await send_keys("j");
    const focus_page_works = Boolean(await wait_event(mark, scroll_of("a"), "j to scroll page a after focus_page", 3000).catch(() => undefined));
    record("focus_page_works", focus_page_works);
    if (!focus_page_works) {
      await send_keys("-k", "Escape", "-k", "Escape");
      throw new Error(`j after the chord did not reach the page (scroll stayed at ${before})`);
    }
  }, { setup: true });
}
