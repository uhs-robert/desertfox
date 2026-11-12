// The jump list: <C-o> goes back to the place a big jump left and <C-i> forward again, per window, across tabs.
// The cases record places with the keys themselves (gg, G and a navigation), as a user does. Only the case about a chord held during a bundle load stores a place by a `jump_push` message from the page's tab, because the page bundle is already loaded by any key that records.
// A private window keeps its own list, and the harness has no private window helper, so only the unit tests cover that.

export const areas = ["scroll", "keys", "tabs", "bundles", "hints"];

export async function run_cases({ run_case, open_page, press_keys, poll_until, events, wait_event, wait_active_tab, scroll_of, last_scroll_y, expect, expect_no_scroll, in_active_tab, in_background, sleep, settle_focus, hint_label_count }) {
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
    const answer = await in_active_tab(`browser.runtime.sendMessage({ type: "jump_push", url: location.href, x: scrollX, y: scrollY })`);
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

  await run_case("a key typed right after G waits for it: G then k at once ends one step above the bottom", async () => {
    await reset_list();
    // A fresh page: the page bundle is not loaded, so G first loads it and the k arrives while it does.
    await open_page("aligned", "p9j_order", { new_tab: true });
    await press_keys("G", "k");
    const settled = (last) => last !== undefined && last.y > 0 && last.y < last.max_y - 1 && last.max_y - last.y < 400;
    await poll_until("the page to reach the bottom and move up", async () => settled(events.filter(scroll_of("p9j_order")).at(-1)));
    await sleep(500);
    const last = events.filter(scroll_of("p9j_order")).at(-1);
    expect(settled(last), `the page ended at ${last.y} of ${last.max_y}`);
    const list = await list_of_window();
    expect(list?.entries.length === 1 && list.entries[0].y === 0, `the place G left: ${JSON.stringify(list)}`);
  });

  await run_case("$ and ^ record no place", async () => {
    await reset_list();
    await open_page("aligned", "p9j_edge", { new_tab: true });
    await press_keys("$");
    await press_keys("^");
    await sleep(300);
    expect((await list_of_window()) === null, `$ and ^ recorded ${JSON.stringify(await list_of_window())}`);
  });

  // Runs in the page's own world, as a single-page app's script does, not in the extension's.
  const page_script = (code) => in_active_tab(`(() => { const script = document.createElement("script"); script.textContent = ${"CODE"}; document.body.append(script); script.remove(); return true; })()`.replace("CODE", JSON.stringify(code)));
  const entries_of = async () => (await list_of_window())?.entries ?? [];
  // A change within the quiet window after a jump or step records nothing, so a case waits it out before the change it means to record.
  const past_quiet_window = () => sleep(1100);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;

  await run_case("a hint follow from a page only scrolled with j records the place, and <C-o> comes back to it", async () => {
    await reset_list();
    await open_page("hints", "p9j_hint", { new_tab: true });
    await press_keys("j");
    await poll_until("the page to move down", async () => last_scroll_y("p9j_hint") > 0);
    const left_y = last_scroll_y("p9j_hint");
    const mark = events.length;
    await press_keys("f");
    await poll_until("the hint labels", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    await wait_event(mark, loaded("hint_one"), "the first link to load");
    await poll_until("the page left to be in the list", async () => (await entries_of()).some((entry) => entry.url.includes("id=p9j_hint") && near(entry.y, left_y)));
    await settle_focus();
    const back = events.length;
    await press_keys(...older);
    await wait_event(back, (event) => scroll_of("p9j_hint")(event) && near(event.y, left_y), "<C-o> to scroll the page back to where the hint follow left it");
  });

  await run_case("a pushState to another address records the place left, and <C-o> returns to it", async () => {
    await reset_list();
    await open_page("aligned", "p9j_spa", { new_tab: true });
    const bottom = await go_to_bottom("p9j_spa");
    await past_quiet_window();
    // As an app does: the address changes, then the new view scrolls to its top.
    await page_script(`history.pushState(null, "", location.pathname + location.search + "&view=2"); scrollTo(0, 0)`);
    await poll_until("the page to show its new view", async () => last_scroll_y("p9j_spa") === 0);
    await poll_until("the place left to be in the list", async () => (await entries_of()).some((entry) => !entry.url.includes("view=2") && near(entry.y, bottom)));
    expect((await entries_of()).length === 2, `the list after G and the push: ${JSON.stringify(await list_of_window())}`);
    const mark = events.length;
    await press_keys(...older);
    await wait_event(mark, (event) => scroll_of("p9j_spa")(event) && near(event.y, bottom), "<C-o> to return to the bottom of the address left");
    expect(!(await in_active_tab(`location.href`)).includes("view=2"), "<C-o> did not return to the address left");
  });

  await run_case("replaceState and a hash change record nothing", async () => {
    await reset_list();
    await open_page("aligned", "p9j_replace", { new_tab: true });
    await go_to_bottom("p9j_replace");
    await past_quiet_window();
    await page_script(`history.replaceState(null, "", location.pathname + location.search + "&sorted=1")`);
    await page_script(`location.hash = "part"`);
    await sleep(300);
    const list = await list_of_window();
    expect(list?.entries.length === 1, `the list after replaceState and a hash change: ${JSON.stringify(list)}`);
  });

  await run_case("on a page that changes its address as it scrolls, G, gg, <C-o> and <C-i> work and the scroll pushes add no place", async () => {
    await reset_list();
    await open_page("aligned", "p9j_sections", { new_tab: true });
    // The address names the half of the page in view, as a long document with sections does.
    await page_script(`addEventListener("scroll", () => {
      const section = scrollY > document.documentElement.scrollHeight / 2 - innerHeight ? "2" : "1";
      const url = new URL(location.href);
      if (url.searchParams.get("section") === section) return;
      url.searchParams.set("section", section);
      history.pushState(null, "", url);
    })`);
    const bottom = await go_to_bottom("p9j_sections");
    await go_to_top("p9j_sections");
    const after_jumps = await list_of_window();
    expect(after_jumps?.entries.length === 2, `the list after G and gg: ${JSON.stringify(after_jumps)}`);
    // The place G left has no section yet. The one gg left is in section 2, so the step back loads that address again.
    const back = events.length;
    await press_keys(...older);
    await wait_event(back, (event) => scroll_of("p9j_sections")(event) && near(event.y, bottom), "<C-o> to return to the bottom");
    await settle_focus();
    const forward = events.length;
    await press_keys(...newer);
    // The top of a fresh load is the place itself, so no scroll shows: the load of the section 1 address does.
    await wait_event(forward, (event) => loaded("p9j_sections")(event) && event.search.includes("section=1"), "<C-i> to load the top's address");
    await poll_until("the page to stand at the top", async () => (await in_active_tab(`scrollY`)) === 0);
    await sleep(300);
    const after_steps = await list_of_window();
    expect(after_steps?.entries.length === 3, `the list after <C-o> and <C-i>: ${JSON.stringify(after_steps)}`);
  });
}
