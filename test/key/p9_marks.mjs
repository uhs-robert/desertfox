// Local marks: m<a-z> sets, '<key> and the backtick jump, '' toggles with the position the last jump left, and which-key lists the page's marks.
// Global marks: m<A-Z> keeps an address, and '<A-Z> switches to the tab on it or opens it in the current tab, then scrolls.
// Quickmarks: M<key> saves the address, go<key> and gn<key> open it here and in a new tab.
// A private window keeps its marks apart from the normal ones, and the harness has no private window or second window helper, so only the unit tests cover those and the tab order across windows.

export const areas = ["scroll", "keys", "whichkey", "tabs"];

export async function run_cases({ run_case, open_page, press_keys, poll_until, events, wait_event, wait_active_tab, scroll_of, last_scroll_y, scroll_delta_by_press, expect, expect_no_scroll, expect_absent, barrier, badge_is, in_active_tab, in_background, which_key_delay_ms, sleep, settle_focus }) {
  const to_y = async (page_id, keys, y, what) => {
    const mark = events.length;
    await press_keys(...keys);
    // A mark keeps whole pixels and a smooth scroll can end between them.
    const near = (at) => Math.abs(at - y) <= 1;
    if (!near(last_scroll_y(page_id))) await wait_event(mark, (event) => scroll_of(page_id)(event) && near(event.y), what);
    expect(near(last_scroll_y(page_id)), `${what}: at ${last_scroll_y(page_id)}, wanted ${y}`);
  };

  const stored_y = (page_id, key) => in_background(`browser.storage.local.get("desertfox_marks").then((stored) => Object.entries(stored.desertfox_marks?.pages ?? {}).filter(([url]) => url.includes("id=${page_id}")).map(([, page]) => page.marks["${key}"]?.[1])[0])`);

  const set_mark = (key) => press_keys("m", key);

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
    await set_mark("a");
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

  await run_case("a mark that is not set toasts and does not scroll, and so does a key outside a to z and A to Z", async () => {
    await open_page("aligned", "p9m_missing", { new_tab: true });
    for (const keys of [["'", "q"], ["'", "Q"], ["m", "1"]]) {
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
    await set_mark("b");
    // The box goes only after the mark has read it.
    await poll_until("the mark to be stored", async () => (await stored_y("p9m_box", "b")) != null);
    await in_active_tab(`document.getElementById("panel").remove(); scrollTo(0, 0)`);
    await poll_until("the page to reach the top", async () => last_scroll_y("p9m_box") === 0);
    await to_y("p9m_box", ["'", "b"], bottom, "'b to scroll the page");
  });

  await run_case("a jump during a smooth scroll ends it and lands on the mark", async () => {
    await open_page("aligned", "p9m_flight", { new_tab: true });
    await set_mark("t");
    await press_keys("G");
    await poll_until("the smooth scroll to start", async () => (await in_active_tab(`scrollY`)) > 0);
    await press_keys("'", "t");
    await poll_until("the jump to land on the top", async () => (await in_active_tab(`scrollY`)) < 1);
    await sleep(700);
    const after = await in_active_tab(`scrollY`);
    expect(after < 1, `the page moved on after the jump, to ${after}`);
  });

  await run_case("m a g g typed back to back stores the position from before gg", async () => {
    await open_page("aligned", "p9m_fast", { new_tab: true });
    const bottom = await go_to_bottom("p9m_fast");
    await press_keys("m", "a", "g", "g");
    await poll_until("the page to reach the top", async () => (await in_active_tab(`scrollY`)) < 1);
    await poll_until("the mark to be stored", async () => (await stored_y("p9m_fast", "a")) != null);
    const stored = await stored_y("p9m_fast", "a");
    expect(Math.abs(stored - bottom) <= 1, `the mark stored ${stored}, the page was at ${bottom}`);
  });

  await run_case("'a then gg typed back to back ends at the top", async () => {
    await press_keys("'", "a", "g", "g");
    await sleep(900);
    const after = await in_active_tab(`scrollY`);
    expect(after < 1, `the page ended at ${after}, not the top`);
  });

  await run_case("a pause after ' lists the marks of the page with their offsets", async () => {
    await open_page("aligned", "p9m_wk", { new_tab: true });
    await set_mark("a");
    await go_to_bottom("p9m_wk");
    await set_mark("b");
    const mark = events.length;
    await press_keys("'");
    const shown = await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9m_wk" && event.value !== "", "the which-key panel");
    // The empty-page panel has one row, `<key>`. Two rows are the two marks.
    expect(shown.value.endsWith(":2"), `the panel does not list both marks: ${shown.value}`);
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9m_wk" && event.value === "", "the panel to close");
    await sleep(which_key_delay_ms);
  });

  const tab_count = () => in_background(`browser.tabs.query({}).then((tabs) => tabs.length)`);
  const global_url = (key) => in_background(`browser.storage.local.get("desertfox_marks").then((stored) => stored.desertfox_marks?.globals?.["${key}"]?.url)`);
  const close_tabs_on = (page_id) => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("id=${page_id}")) await browser.tabs.remove(tab.id); })()`);
  const tab_of = (page_id) => in_background(`browser.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url.includes("id=${page_id}"))?.id)`);

  // The first tab is scrolled to the top after the mark, so the jump has to scroll it.
  await run_case("mA, then 'A from another tab switches back to the first tab without a new tab and scrolls to the mark", async () => {
    await open_page("aligned", "p9g_a", { new_tab: true });
    const bottom = await go_to_bottom("p9g_a");
    await set_mark("A");
    await poll_until("the global mark to be stored", async () => (await global_url("A")) != null);
    await scroll_delta_by_press("p9g_a", ["g", "g"]);
    await poll_until("the page to reach the top", async () => last_scroll_y("p9g_a") === 0);
    await open_page("aligned", "p9g_b", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await press_keys("'", "A");
    await wait_active_tab("p9g_a", "the first tab to be active after 'A");
    await wait_event(mark, (event) => scroll_of("p9g_a")(event) && Math.abs(event.y - bottom) <= 1, "the first tab to scroll to the mark");
    expect((await tab_count()) === tabs_before, "'A opened a tab");
  });

  await run_case("keys typed in the old tab right after a 'A that switched away still run when the user is back there", async () => {
    const second = await tab_of("p9g_b");
    await in_background(`browser.tabs.update(${second}, { active: true })`);
    await wait_active_tab("p9g_b", "the second tab to be active");
    await settle_focus();
    expect(last_scroll_y("p9g_b") === 0, "the second tab did not start at the top");
    await press_keys("'", "A");
    await wait_active_tab("p9g_a", "the first tab after 'A from the second");
    await in_background(`browser.tabs.update(${second}, { active: true })`);
    await wait_active_tab("p9g_b", "the second tab to be active again");
    await settle_focus();
    await scroll_delta_by_press("p9g_b", ["j"]);
    expect(last_scroll_y("p9g_b") > 0, "j did not scroll the old tab after 'A switched away");
  });

  await run_case("a hash change on the marked tab still matches it", async () => {
    await in_background(`(async () => { const id = ${await tab_of("p9g_a")}; await browser.tabs.executeScript(id, { code: "location.hash = 'other'; scrollTo(0, 0)" }); })()`);
    const back = await tab_of("p9g_b");
    await in_background(`browser.tabs.update(${back}, { active: true })`);
    await wait_active_tab("p9g_b", "the second tab");
    await settle_focus();
    const tabs_before = await tab_count();
    await press_keys("'", "A");
    await wait_active_tab("p9g_a", "the first tab after 'A with a hash on its address");
    expect((await tab_count()) === tabs_before, "'A opened a tab although the hash only differs");
  });

  await run_case("with the marked tab closed, 'A opens the address in the current tab and scrolls after the load", async () => {
    await close_tabs_on("p9g_a");
    await wait_active_tab((page_id) => page_id !== "p9g_a", "another tab to be active");
    await settle_focus();
    const tabs_before = await tab_count();
    const mark = events.length;
    await press_keys("'", "A");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9g_a", "the marked address to load in the current tab");
    await wait_event(mark, (event) => scroll_of("p9g_a")(event) && event.y > 0, "the loaded page to scroll to the mark");
    expect((await tab_count()) === tabs_before, "'A opened a new tab");
  });

  await run_case("a pause after ' lists the global mark with its address after the page's marks", async () => {
    await open_page("aligned", "p9g_wk", { new_tab: true });
    await set_mark("a");
    await poll_until("the mark to be stored", async () => (await stored_y("p9g_wk", "a")) != null);
    const mark = events.length;
    await press_keys("'");
    const shown = await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9g_wk" && event.value !== "", "the which-key panel");
    // One local row and the global A.
    expect(shown.value.endsWith(":2"), `the panel does not list the page mark and the global mark: ${shown.value}`);
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9g_wk" && event.value === "", "the panel to close");
    await sleep(which_key_delay_ms);
  });

  const quickmark_url = (key) => in_background(`browser.storage.local.get("desertfox_quickmarks").then((stored) => stored.desertfox_quickmarks?.["${key}"])`);

  await run_case("Mq saves the address, gnq opens it in a new tab, goq opens it in this tab, and a pause after go lists it", async () => {
    await open_page("aligned", "p9q_a", { new_tab: true });
    await press_keys("M", "q");
    await poll_until("the quickmark to be stored", async () => (await quickmark_url("q"))?.includes("id=p9q_a"));
    await open_page("aligned", "p9q_b", { new_tab: true });
    const tabs_before = await tab_count();
    let mark = events.length;
    await press_keys("g", "n", "q");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9q_a", "the quickmark to load in a new tab");
    expect((await tab_count()) === tabs_before + 1, "gnq did not open exactly one tab");
    await close_tabs_on("p9q_a");
    await open_page("aligned", "p9q_c", { new_tab: true });
    mark = events.length;
    await press_keys("g", "o", "q");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9q_a", "the quickmark to load in this tab");
    await open_page("aligned", "p9q_wk", { new_tab: true });
    mark = events.length;
    await press_keys("g", "o");
    const shown = await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9q_wk" && event.value !== "", "the which-key panel under go");
    expect(shown.value.endsWith(":1"), `the panel does not list the one quickmark: ${shown.value}`);
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9q_wk" && event.value === "", "the panel to close");
    await sleep(which_key_delay_ms);
  });

  // The Escape drops the pending key argument and nothing else. The next key is a fresh start, so it is no mark name, no jump target and no macro register.
  await run_case("Escape after m, ', q or @ drops the argument, and the next key is a fresh start", async () => {
    const page_id = "p9m_escape";
    await open_page("aligned", page_id, { new_tab: true });
    const bottom = await go_to_bottom(page_id);
    await press_keys("m", "-k", "Escape");
    await press_keys("a");
    await barrier(page_id);
    expect((await stored_y(page_id, "a")) == null, "m, Escape, a stored a mark a");
    // A mark to jump to, and the jump after an Escape must not go there.
    await set_mark("b");
    await poll_until("the mark to be stored", async () => (await stored_y(page_id, "b")) != null);
    await scroll_delta_by_press(page_id, ["g", "g"]);
    await poll_until("the page to reach the top", async () => last_scroll_y(page_id) === 0);
    const mark_jump = events.length;
    await press_keys("'", "-k", "Escape");
    await press_keys("b");
    await expect_no_scroll(mark_jump, page_id);
    expect(last_scroll_y(page_id) === 0, `', Escape, b scrolled the page to ${last_scroll_y(page_id)}, the mark b is at ${bottom}`);
    const mark = events.length;
    await press_keys("q", "-k", "Escape");
    await press_keys("a");
    await expect_absent(mark, page_id, (event) => event.type === "indicator" && event.page_id === page_id && /recording/.test(event.label), "a recording badge after q, Escape, a");
    await press_keys("@", "-k", "Escape");
    await press_keys("a");
    await barrier(page_id);
  });
}
