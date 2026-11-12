// The jump list: <C-o> goes back to the place a big jump left and <C-i> forward again, per window, across tabs.
// Nothing records a jump yet, so a case stores a place the way the recorder will: a `jump_push` message from the page's tab, sent through the content script world of the active tab.
// A private window keeps its own list, and the harness has no private window helper, so only the unit tests cover that.

export const areas = ["scroll", "keys", "tabs"];

export async function run_cases({ run_case, open_page, press_keys, poll_until, events, wait_event, wait_active_tab, scroll_of, last_scroll_y, expect, expect_no_scroll, in_active_tab, in_background, sleep, settle_focus }) {
  const near = (at, y) => Math.abs(at - y) <= 1;
  const to_y = async (page_id, keys, y, what) => {
    const mark = events.length;
    await press_keys(...keys);
    if (!near(last_scroll_y(page_id), y)) await wait_event(mark, (event) => scroll_of(page_id)(event) && near(event.y, y), what);
    expect(near(last_scroll_y(page_id), y), `${what}: at ${last_scroll_y(page_id)}, wanted ${y}`);
  };
  const older = ["-M", "ctrl", "o", "-m", "ctrl"];
  const newer = ["-M", "ctrl", "i", "-m", "ctrl"];

  const reset_list = () => in_background(`browser.storage.session.remove("desertfox_jumps")`);
  const list_of_window = () => in_background(`(async () => { const window_id = (await browser.windows.getLastFocused()).id; const stored = await browser.storage.session.get("desertfox_jumps"); return stored.desertfox_jumps?.windows?.[window_id] ?? null; })()`);
  const push_here = async () => {
    const answer = await in_active_tab(`browser.runtime.sendMessage({ type: "jump_push", x: scrollX, y: scrollY })`);
    expect(answer?.ok === true, `jump_push answered ${JSON.stringify(answer)}`);
  };
  const go_to_bottom = async (page_id) => {
    await press_keys("G");
    await poll_until("the page to reach the bottom", async () => {
      const last = events.filter(scroll_of(page_id)).at(-1);
      return last !== undefined && last.y > 0 && Math.abs(last.y - last.max_y) <= 1;
    });
    return last_scroll_y(page_id);
  };
  const go_to_top = async (page_id) => {
    await press_keys("g", "g");
    await poll_until("the page to reach the top", async () => last_scroll_y(page_id) === 0);
  };
  const tab_count = () => in_background(`browser.tabs.query({}).then((tabs) => tabs.length)`);
  const tab_of = (page_id) => in_background(`browser.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url.includes("id=${page_id}"))?.id)`);
  const close_tabs_on = (page_id) => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("id=${page_id}")) await browser.tabs.remove(tab.id); })()`);
  const expect_toast = async (page_id, keys, what) => {
    const mark = events.length;
    await press_keys(...keys);
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === page_id, what);
    await expect_no_scroll(mark, page_id);
    await poll_until("the toast to go", async () => events.slice(mark).some((event) => event.type === "toast_gone" && event.page_id === page_id));
  };

  await run_case("<C-o> returns to the place gg left and <C-i> goes forward again", async () => {
    await reset_list();
    await open_page("aligned", "p9j_a", { new_tab: true });
    const bottom = await go_to_bottom("p9j_a");
    await push_here();
    await go_to_top("p9j_a");
    await to_y("p9j_a", older, bottom, "<C-o> to return to the bottom");
    await to_y("p9j_a", newer, 0, "<C-i> to go forward to the top");
  });

  await run_case("a step past either end toasts and does not scroll", async () => {
    // The list is [bottom, top] and the cursor is on the top, the newest place.
    await expect_toast("p9j_a", newer, "a toast after <C-i> at the newest place");
    await reset_list();
    await expect_toast("p9j_a", older, "a toast after <C-o> with an empty list");
  });

  await run_case("two <C-o> typed back to back walk two places back", async () => {
    await reset_list();
    await open_page("aligned", "p9j_fast", { new_tab: true });
    const bottom = await go_to_bottom("p9j_fast");
    await push_here();
    await press_keys("k", "k", "k");
    await poll_until("the page to move up", async () => last_scroll_y("p9j_fast") < bottom);
    const middle = last_scroll_y("p9j_fast");
    await push_here();
    await go_to_top("p9j_fast");
    // The page bundle is not loaded on this page yet: the second press arrives during its load and must wait for it.
    await press_keys(...older);
    await press_keys(...older);
    expect(middle !== bottom, "the two places are one place");
    await poll_until("both steps to land", async () => {
      const list = await list_of_window();
      return list?.cursor === 0 && near(await in_active_tab(`scrollY`), bottom);
    });
    const list = await list_of_window();
    expect(list.entries.length === 3, `the list after two steps: ${JSON.stringify(list)}`);
  });

  await run_case("<C-o> from another tab switches to the tab of the place without opening a tab, and <C-i> comes back", async () => {
    await reset_list();
    await open_page("aligned", "p9j_x", { new_tab: true });
    const bottom = await go_to_bottom("p9j_x");
    await push_here();
    await go_to_top("p9j_x");
    await open_page("aligned", "p9j_y", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await press_keys(...older);
    await wait_active_tab("p9j_x", "the first tab to be active after <C-o>");
    await wait_event(mark, (event) => scroll_of("p9j_x")(event) && near(event.y, bottom), "the first tab to scroll to the place");
    expect((await tab_count()) === tabs_before, "<C-o> opened a tab");
    await settle_focus();
    await press_keys(...newer);
    await wait_active_tab("p9j_y", "the second tab to be active after <C-i>");
    expect((await tab_count()) === tabs_before, "<C-i> opened a tab");
  });

  await run_case("with the tab of the place closed, <C-o> opens the address in the current tab and scrolls after the load", async () => {
    await reset_list();
    await open_page("aligned", "p9j_gone", { new_tab: true });
    await go_to_bottom("p9j_gone");
    await push_here();
    await close_tabs_on("p9j_gone");
    await open_page("aligned", "p9j_now", { new_tab: true });
    await settle_focus();
    const tabs_before = await tab_count();
    const mark = events.length;
    await press_keys(...older);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9j_gone", "the address to load in the current tab");
    await wait_event(mark, (event) => scroll_of("p9j_gone")(event) && event.y > 0, "the loaded page to scroll to the place");
    expect((await tab_count()) === tabs_before, "<C-o> opened a new tab");
    expect((await tab_of("p9j_now")) == null, "the current tab did not navigate");
  });

  await run_case("a tab that closes while <C-o> waits for its page leaves the cursor usable", async () => {
    await reset_list();
    await open_page("aligned", "p9j_c1", { new_tab: true });
    await go_to_bottom("p9j_c1");
    await push_here();
    await open_page("aligned", "p9j_c2", { new_tab: true });
    await press_keys(...older);
    await wait_active_tab("p9j_c1", "the first tab after <C-o>");
    await close_tabs_on("p9j_c1");
    await wait_active_tab((page_id) => page_id !== "p9j_c1", "another tab to be active");
    await settle_focus();
    // The list moved on its own: from here the newer place is the tab that was left.
    const list = await list_of_window();
    expect(list !== null && list.cursor === 0, `the cursor after the closed tab: ${JSON.stringify(list)}`);
    await sleep(300);
  });
}
