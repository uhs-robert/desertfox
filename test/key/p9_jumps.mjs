// The jump list: <C-o> goes back to the place a big jump left and <C-i> forward again, per window, across tabs.
// The cases record places with the keys themselves (gg, G and a navigation), as a user does. Only the case about a chord held during a bundle load stores a place by a `jump_push` message from the page's tab, because the page bundle is already loaded by any key that records.
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
    // G leaves the top and gg leaves the bottom: the keys record, with no push of ours.
    const bottom = await go_to_bottom("p9j_a");
    await go_to_top("p9j_a");
    expect((await list_of_window())?.entries.length === 2, `the list after G and gg: ${JSON.stringify(await list_of_window())}`);
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
    // Neither gg nor G runs here: they would load the page bundle, and this case needs it unloaded. The places come from the seam and the scroll from the page.
    const scroll_to = (y) => in_active_tab(`(scrollTo(0, ${y}), scrollY)`);
    const bottom = await scroll_to(1e6);
    await push_here();
    const middle = await scroll_to(bottom / 2);
    await push_here();
    await scroll_to(0);
    expect(middle !== bottom && middle > 0, "the two places are one place");
    // The page bundle is not loaded on this page yet: the second press arrives during its load and must wait for it.
    await press_keys(...older);
    await press_keys(...older);
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
    await go_to_top("p9j_gone");
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
    await go_to_top("p9j_c1");
    await open_page("aligned", "p9j_c2", { new_tab: true });
    await press_keys(...older);
    await wait_active_tab("p9j_c1", "the first tab after <C-o>");
    await close_tabs_on("p9j_c1");
    await wait_active_tab((page_id) => page_id !== "p9j_c1", "another tab to be active");
    await settle_focus();
    // The list moved on its own: from here the newer place is the tab that was left.
    const list = await list_of_window();
    expect(list !== null && list.cursor === 1, `the cursor after the closed tab: ${JSON.stringify(list)}`);
    await sleep(300);
  });

  await run_case("j is not a jump, G is, and the address changing in the tab records where the page was left", async () => {
    await reset_list();
    await open_page("aligned", "p9j_n1", { new_tab: true });
    await press_keys("j", "j", "j");
    await poll_until("the page to move down", async () => last_scroll_y("p9j_n1") > 0);
    expect((await list_of_window()) === null, `j recorded ${JSON.stringify(await list_of_window())}`);
    const bottom = await go_to_bottom("p9j_n1");
    const after_g = await list_of_window();
    expect(after_g?.entries.length === 1, `the list after G: ${JSON.stringify(after_g)}`);
    // The page hides as the tab goes to another address, and the background records the offset it reported.
    await open_page("aligned", "p9j_n2", {});
    await poll_until("the page that was left to be in the list", async () => (await list_of_window())?.entries.some((entry) => entry.url.includes("id=p9j_n1") && near(entry.y, bottom)) === true);
  });

  await run_case("a reload records no place", async () => {
    await reset_list();
    await open_page("aligned", "p9j_r", { new_tab: true });
    await go_to_bottom("p9j_r");
    const mark = events.length;
    await in_active_tab(`location.reload()`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9j_r", "the reloaded page");
    await settle_focus();
    const list = await list_of_window();
    expect(list?.entries.length === 1, `the list after a reload: ${JSON.stringify(list)}`);
  });
}
