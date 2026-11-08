// The core keys: tab switching, scrolling, ignore mode, typing in a field, chords on pages that cancel keys, and the focus_page chord.
// Tab order is a, b, c, then f, s and the about: page as each step opens them. The wrap cases rely on a being first.
import { ALT, CTRL, SHIFT_ESCAPE } from "./harness.mjs";

export const areas = ["scroll", "tabs", "keys"];

export async function run_cases({ run_case, setup, expect, open_page, press_keys, settle_focus, settle_tab_switch, poll_until, wait_tab_quiet, events, wait_event, since, find_event, scroll_delta_by_press, became_visible, scroll_of, last_scroll_y, expect_absent, expect_no_scroll, expect_exactly_one_visible, in_background, record, type_in_address_bar }) {
  await setup("open pages a, b and c", async () => {
    await open_page("page", "a", { new_tab: false });
    await open_page("page", "b", { new_tab: true });
    await open_page("page", "c", { new_tab: true });
  });

  await run_case("J and K switch tabs", async () => {
    for (const [keys, expected] of [["K", "b"], ["K", "a"], ["J", "b"], ["J", "c"]]) {
      const mark = events.length;
      await press_keys(keys);
      await wait_event(mark, became_visible(expected), `tab ${expected} after ${keys}`);
      await settle_tab_switch();
    }
  });

  await run_case("j scrolls, 3j scrolls three times as far", async () => {
    const single_j_pixels = await scroll_delta_by_press("c", ["j"]);
    expect(single_j_pixels > 0, "j did not scroll down");
    const triple = await scroll_delta_by_press("c", ["3j"]);
    expect(Math.abs(triple - 3 * single_j_pixels) <= 3, `3j moved ${triple}px, j moved ${single_j_pixels}px`);
  }, { setup: true });

  await run_case("G jumps to the bottom and gg to the top", async () => {
    await scroll_delta_by_press("c", ["G"]);
    const bottom = events.filter(scroll_of("c")).at(-1);
    expect(bottom.y >= bottom.max_y - 2, `G stopped at ${bottom.y} of ${bottom.max_y}`);
    await scroll_delta_by_press("c", ["gg"]);
    expect(last_scroll_y("c") === 0, `gg stopped at ${last_scroll_y("c")}`);
  });

  const is_label = (label) => (event) => event.type === "indicator" && event.page_id === "c" && event.label === label;
  const press_for_label = async (keys, label) => {
    const mark = events.length;
    await press_keys(...keys);
    await wait_event(mark, is_label(label), `the ${label} badge`);
  };

  await run_case("ignore mode passes keys to the page and leaves again", async () => {
    await press_for_label(SHIFT_ESCAPE, "IGNORE");
    let mark = events.length;
    await press_keys("j");
    await wait_event(mark, (event) => event.type === "keydown" && event.key === "j", "the page to see j in ignore mode");
    await expect_no_scroll(mark, "c");
    await press_for_label(SHIFT_ESCAPE, "NORMAL");
    mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of("c"), "scroll after leaving ignore mode");
    expect(!find_event(mark, (event) => event.type === "keydown" && event.key === "j"), "the page saw j in normal mode");
  });

  await run_case("the mode badge shows NORMAL, then IGNORE, then NORMAL", async () => {
    expect(events.some(is_label("NORMAL")), "no NORMAL badge at start");
    await press_for_label(SHIFT_ESCAPE, "IGNORE");
    await press_for_label(SHIFT_ESCAPE, "NORMAL");
  });

  await setup("open the field page f", () => open_page("field", "f", { new_tab: true }));
  await run_case("typing in a field is not swallowed", async () => {
    const typed = "jkxGddqrgg 3j";
    const mark = events.length;
    await press_keys(typed);
    await wait_event(mark, (event) => event.type === "input" && event.value === typed, `the field to hold "${typed}"`);
    await expect_absent(mark, "f", (event) => event.type === "visibility", "a tab switch happened while typing");
    // A stray character after the text shows as an input report that is no prefix of the text. The reports of fast keys can reach the server out of order, so their order proves nothing.
    const stray = since(mark).find((event) => event.type === "input" && !typed.startsWith(event.value));
    expect(!stray, `field held "${stray?.value}", typed "${typed}"`);
  });

  await run_case("Escape leaves the field and keys act again", async () => {
    await press_keys("-k", "Escape");
    await poll_until("the field to lose the focus", async () => {
      const answer = await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); return browser.tabs.executeScript(tab.id, { code: "document.activeElement?.id" }); })()`);
      return typeof answer?.[0] === "string" && answer[0] !== "field";
    });
    const mark = events.length;
    await press_keys("K");
    await wait_event(mark, became_visible("c"), "tab c after K");
    await settle_tab_switch();
    await press_keys("J");
    await wait_event(mark, became_visible("f"), "tab f after J");
    await settle_tab_switch();
  });

  await setup("open the key-cancelling page s", () => open_page("swallow", "s", { new_tab: true }));
  await run_case("J and K work on a page that cancels keys in its own capture listener", async () => {
    let mark = events.length;
    await press_keys("K");
    await wait_event(mark, became_visible("f"), "tab f after K");
    await settle_tab_switch();
    await press_keys("J");
    await wait_event(mark, became_visible("s"), "tab s after J");
    await settle_tab_switch();
  });

  await run_case("chord on a cancelling page acts exactly once", async () => {
    let mark = events.length;
    await press_keys(...ALT("j"));
    await expect_exactly_one_visible(mark, "a");
    mark = events.length;
    await press_keys(...ALT("k"));
    await expect_exactly_one_visible(mark, "s", { destination_cancels_keys: true });
  });

  await run_case("chord on a normal page acts exactly once", async () => {
    await press_keys("gg");
    let mark = events.length;
    await press_keys("K");
    await wait_event(mark, became_visible("f"), "tab f after K");
    await settle_tab_switch();
    mark = events.length;
    await press_keys(...ALT("k"));
    await expect_exactly_one_visible(mark, "c");
    mark = events.length;
    await press_keys(...ALT("j"));
    await expect_exactly_one_visible(mark, "f");
  });

  const active_url = () => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab?.url)`);
  // Extensions cannot open an about: page, so the address bar does.
  const tab_count = () => in_background(`browser.tabs.query({}).then((tabs) => tabs.length)`);
  await setup("open about:support", async () => {
    const tabs_before = await tab_count();
    await press_keys(...CTRL("t"));
    await poll_until("the new tab to open", async () => (await tab_count()) === tabs_before + 1);
    // Text typed in the same run as Ctrl+L loses its first characters, so the page losing the focus to the address bar comes first.
    await press_keys(...CTRL("l"));
    await poll_until("the new tab page to lose the focus to the address bar", async () => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "document.hasFocus()" }))`))?.[0] === false, { expected_timeout: true }).catch(() => undefined);
    await type_in_address_bar("about:support");
    await press_keys("-k", "Return");
    await poll_until("about:support to load", async () => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.url === "about:support" && tab.status === "complete" ? tab.id : 0)`)) > 0, { timeout_ms: 8000 });
    await wait_tab_quiet(await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.id)`));
  });

  await run_case("Alt+J and Alt+K work on an about: page", async () => {
    let mark = events.length;
    await press_keys(...ALT("k"));
    await expect_exactly_one_visible(mark, "s", { destination_cancels_keys: true });
    await press_keys(...ALT("j"));
    await poll_until("the about:support tab to be active", async () => (await active_url()) === "about:support");
    mark = events.length;
    await press_keys(...ALT("j"));
    await expect_exactly_one_visible(mark, "a");
  }, { setup: true });

  await run_case("focus_page from the address bar returns keys to the page", async () => {
    const before = last_scroll_y("a");
    const mark = events.length;
    const page_focus = async () => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "document.hasFocus()" }))`))?.[0];
    await press_keys(...CTRL("l"));
    await poll_until("the page to lose the focus to the address bar", async () => (await page_focus()) === false);
    await press_keys(...ALT(","));
    const page_has_focus_again = await poll_until("the page to take the focus back", async () => (await page_focus()) === true).then(() => true, () => false);
    if (page_has_focus_again) await press_keys("j");
    const focus_page_works = page_has_focus_again && Boolean(await wait_event(mark, scroll_of("a"), "j to scroll page a after focus_page", 3000).catch(() => undefined));
    record("focus_page_works", focus_page_works);
    if (!focus_page_works) {
      await press_keys("-k", "Escape", "-k", "Escape");
      throw new Error(`j after the chord did not reach the page (scroll stayed at ${before})`);
    }
  }, { setup: true });
}
