// Local marks: m<a-z> sets, '<key> and the backtick jump, '' toggles with the position the last jump left, and which-key lists the page's marks.
// A private window keeps its marks apart from the normal ones. The harness has no private window, so only the unit tests cover that.

export const areas = ["scroll", "keys", "whichkey"];

export async function run_cases({ run_case, open_page, press_keys, poll_until, events, wait_event, scroll_of, last_scroll_y, scroll_delta_by_press, expect, expect_no_scroll, in_active_tab, in_background, which_key_delay_ms, sleep, settle_focus }) {
  const to_y = async (page_id, keys, y, what) => {
    const mark = events.length;
    await press_keys(...keys);
    // A mark keeps whole pixels and a smooth scroll can end between them.
    const near = (at) => Math.abs(at - y) <= 1;
    if (!near(last_scroll_y(page_id))) await wait_event(mark, (event) => scroll_of(page_id)(event) && near(event.y), what);
    expect(near(last_scroll_y(page_id)), `${what}: at ${last_scroll_y(page_id)}, wanted ${y}`);
  };

  // A mark is set when the background has stored it. A key sent in the same instant can move the page before the set reads it, which a typist never does, so the test waits for the store.
  const set_mark = async (key, page_id) => {
    await press_keys("m", key);
    const stored_on_page = `browser.storage.local.get("desertfox_marks").then((stored) => Object.entries(stored.desertfox_marks?.pages ?? {}).some(([url, page]) => url.includes("id=${page_id}") && "${key}" in page.marks))`;
    await poll_until(`the mark ${key} to be stored`, () => in_background(stored_on_page));
  };

  // G scrolls smoothly, so the first report can come mid-way. The bottom is where the last report equals the page's maximum.
  const go_to_bottom = async (page_id) => {
    await press_keys("G");
    await poll_until("the page to reach the bottom", async () => {
      const last = events.filter(scroll_of(page_id)).at(-1);
      return last !== undefined && last.y > 0 && Math.abs(last.y - last.max_y) <= 1;
    });
    return last_scroll_y(page_id);
  };

  await run_case("ma, a scroll away and 'a come back, and the backtick does the same", async () => {
    await open_page("aligned", "p9m_jump", { new_tab: true });
    const bottom = await go_to_bottom("p9m_jump");
    await set_mark("a", "p9m_jump");
    await scroll_delta_by_press("p9m_jump", ["g", "g"]);
    await poll_until("the page to reach the top", async () => last_scroll_y("p9m_jump") === 0);
    await to_y("p9m_jump", ["'", "a"], bottom, "'a to return to the mark");
    await scroll_delta_by_press("p9m_jump", ["g", "g"]);
    await poll_until("the page to reach the top", async () => last_scroll_y("p9m_jump") === 0);
    await to_y("p9m_jump", ["`", "a"], bottom, "`a to return to the mark");
  });

  await run_case("'' toggles between the spot a jump left and the mark, twice in a row", async () => {
    // The page is at the mark `a` (the bottom) after the last case, and the jump left the top.
    const bottom = last_scroll_y("p9m_jump");
    await to_y("p9m_jump", ["'", "'"], 0, "'' to return to where the jump started");
    await to_y("p9m_jump", ["'", "'"], bottom, "a second '' to toggle back");
  });

  await run_case("a mark survives a hash change and a reload of the page", async () => {
    const bottom = last_scroll_y("p9m_jump");
    await in_active_tab(`location.hash = "other"; scrollTo(0, 0)`);
    await poll_until("the page to reach the top", async () => last_scroll_y("p9m_jump") === 0);
    await to_y("p9m_jump", ["'", "a"], bottom, "'a after a hash change");
    const mark = events.length;
    await in_active_tab(`location.reload()`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9m_jump", "the page to load again");
    await settle_focus();
    await poll_until("the reloaded page to sit at the top", async () => last_scroll_y("p9m_jump") === 0 || events.slice(mark).some(scroll_of("p9m_jump")));
    await to_y("p9m_jump", ["'", "a"], bottom, "'a after a reload");
  });

  await run_case("a mark that is not set toasts and does not scroll, and so does a key outside a to z", async () => {
    await open_page("aligned", "p9m_missing", { new_tab: true });
    for (const keys of [["'", "q"], ["m", "A"], ["m", "1"]]) {
      const mark = events.length;
      await press_keys(...keys);
      await wait_event(mark, (event) => event.type === "toast" && event.page_id === "p9m_missing", `a toast after ${keys.join("")}`);
      await expect_no_scroll(mark, "p9m_missing");
      await poll_until("the toast to go", async () => events.slice(mark).some((event) => event.type === "toast_gone" && event.page_id === "p9m_missing"));
    }
  });

  await run_case("a mark in a box that left the page still jumps, in the box that scrolls now", async () => {
    await open_page("scrollbox", "p9m_box", { new_tab: true });
    const bottom = await go_to_bottom("p9m_box");
    await set_mark("b", "p9m_box");
    await in_active_tab(`document.getElementById("panel").remove(); scrollTo(0, 0)`);
    await poll_until("the page to reach the top", async () => last_scroll_y("p9m_box") === 0);
    await to_y("p9m_box", ["'", "b"], bottom, "'b to scroll the page");
  });

  await run_case("a jump during a smooth scroll ends it and lands on the mark", async () => {
    await open_page("aligned", "p9m_flight", { new_tab: true });
    await set_mark("t", "p9m_flight");
    await press_keys("G");
    await poll_until("the smooth scroll to start", async () => (await in_active_tab(`scrollY`)) > 0);
    await press_keys("'", "t");
    await poll_until("the jump to land on the top", async () => (await in_active_tab(`scrollY`)) < 1);
    await sleep(700);
    const after = await in_active_tab(`scrollY`);
    expect(after < 1, `the page moved on after the jump, to ${after}`);
  });

  await run_case("a pause after ' lists the marks of the page with their offsets", async () => {
    await open_page("aligned", "p9m_wk", { new_tab: true });
    await set_mark("a", "p9m_wk");
    await go_to_bottom("p9m_wk");
    await set_mark("b", "p9m_wk");
    const mark = events.length;
    await press_keys("'");
    const shown = await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9m_wk" && event.value !== "", "the which-key panel");
    // The empty-page panel has one row, `<key>`. Two rows are the two marks.
    expect(shown.value.endsWith(":2"), `the panel does not list both marks: ${shown.value}`);
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9m_wk" && event.value === "", "the panel to close");
    await sleep(which_key_delay_ms);
  });
}
