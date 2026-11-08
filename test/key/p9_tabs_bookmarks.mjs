// Key test cases of piece P3 PR E (tab and bookmark completion). run.mjs calls run_cases with its helpers.
// The list sits in the extension-origin iframe, so the cases drive it with keys and check what the commands did.
import { evaluate_in_background } from "./rdp.mjs";

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
const ALT = (key) => ["-M", "alt", key, "-m", "alt"];

export const areas = ["cmdline", "tabs"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, sleep, press_keys, open_page, wait_event, wait_cmdline, close_cmdline, close_tabs_with, poll_until, settle_focus, events, expect, url_of, became_visible, take_shot }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  // Opens the line on a page that has the keys. The tab before may have been switched or closed by the case before.
  const open_line = async () => {
    await settle_focus();
    await press_keys(":");
    await wait_cmdline((line) => line.ready, "the command line to open");
  };
  // Creates tabs in the background and waits until their content scripts have read them, so the list has them with their titles.
  const create_tabs = async (page_ids) => {
    const mark = events.length;
    const ids = await background(`(async () => {
      const ids = [];
      for (const url of ${JSON.stringify(page_ids.map((page_id) => url_of("page", page_id)))}) ids.push((await browser.tabs.create({ url, active: false })).id);
      return ids;
    })()`);
    for (const page_id of page_ids) await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === page_id, `the content script on ${page_id}`);
    return ids;
  };
  const shows_row = (text) => (line) => line.row_texts.some((row) => row.includes(text));
  // The list draws a status flag on a row once the tab model patch has arrived, so a flag shows that the effect of a key reached the list.
  const row_has_flag = (text, flag) => (line) => line.row_texts.some((row, index) => row.includes(text) && line.row_flags[index].includes(flag));

  await open_page("page", "p9e_one", { new_tab: true });
  await open_page("page", "p9e_two", { new_tab: true });
  await open_page("page", "p9e_three", { new_tab: true });

  await run_case("tab, a typed name, Tab and Enter switch to that tab", async () => {
    await open_line();
    const mark = events.length;
    await press_keys("tab p9e_one", "-k", "Tab", "-k", "Return");
    await wait_event(mark, became_visible("p9e_one"), "tab p9e_one after the pick");
  });

  await run_case("a leading number picks the tab at that place of the tab bar", async () => {
    const tabs = await background(`(async () => (await browser.tabs.query({ currentWindow: true })).map((tab) => tab.url))()`);
    const place = tabs.findIndex((url) => url.includes("p9e_three")) + 1;
    expect(place > 0, "p9e_three is not in the window");
    await open_line();
    const mark = events.length;
    await press_keys(`tab ${place}`, "-k", "Return");
    await wait_event(mark, became_visible("p9e_three"), `tab p9e_three after "tab ${place}"`);
  });

  await run_case("the tabs list shows a tab created while the list is open, with no keypress", async () => {
    let live_id;
    let picked = false;
    try {
      await open_line();
      await press_keys("tab p9e_live");
      await wait_cmdline((line) => line.value === "tab p9e_live", "the typed name in the line");
      // The list has no match yet. The model patch adds the row, and the pick below finds it.
      live_id = await background(`browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9e_live"))}, active: false }).then((tab) => tab.id)`);
      await wait_cmdline(shows_row("p9e_live"), "the new tab in the list");
      const mark = events.length;
      await press_keys("-k", "Tab", "-k", "Return");
      picked = true;
      await wait_event(mark, became_visible("p9e_live"), "the tab created under the open list");
    } finally {
      // A failed case must leave neither the tab nor the open line behind for the cases after it.
      if (live_id !== undefined) await background(`browser.tabs.remove(${live_id}).catch(() => {})`);
      if (!picked) await close_cmdline();
    }
  });

  await run_case("bookmark -t lists the bookmarks, and a pick opens it in a new tab", async () => {
    await background(`browser.bookmarks.create({ title: "P9e Zeta bookmark", url: ${JSON.stringify(url_of("page", "p9e_mark"))} })`);
    await open_line();
    const mark = events.length;
    await press_keys("bookmark -t zeta", "-k", "Tab", "-k", "Return");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9e_mark", "the bookmarked page in a new tab");
    await close_tabs_with("id=p9e_mark");
  });

  // Set DESERTFOX_SHOT_DIR to also save a screenshot of the tab list: a pinned tab with a favicon, a container tab, a muted tab and a discarded tab.
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  if (shot_dir) {
    await run_case("screenshot of the tab list with status marks, a container and a favicon", async () => {
      let made;
      try {
      made = await background(`(async () => {
        const fox = await browser.contextualIdentities.create({ name: "Work", color: "orange", icon: "briefcase" });
        const ids = [];
        const open = async (props) => ids.push((await browser.tabs.create({ active: false, ...props })).id);
        await open({ url: ${JSON.stringify(url_of("iconed", "p9e_pinned"))}, pinned: true });
        await open({ url: ${JSON.stringify(url_of("page", "p9e_work"))}, cookieStoreId: fox.cookieStoreId });
        await open({ url: ${JSON.stringify(url_of("iconed", "p9e_muted"))} });
        await browser.tabs.update(ids[2], { muted: true });
        await open({ url: ${JSON.stringify(url_of("page", "p9e_asleep"))} });
        return { ids, container: fox.cookieStoreId };
      })()`);
      await sleep(1500);
      // Go to p9e_one and back, so `#` has a tab to mark.
      await background(`(async () => {
        const [first, third] = ["p9e_one", "p9e_three"].map((id) => browser.tabs.query({ currentWindow: true, url: "*://*/*id=" + id }));
        await browser.tabs.update((await first)[0].id, { active: true });
        await browser.tabs.update((await third)[0].id, { active: true });
      })()`);
      await background(`browser.tabs.discard(${made.ids[3]})`);
      await sleep(500);
      await send_keys(":");
      await sleep(600);
      await send_keys("tab p9e");
      await sleep(900);
      await take_shot(`${shot_dir}/tab-list.png`);
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys("-k", "Escape");
      await sleep(400);
      } finally {
        if (made) await background(`(async () => { await browser.tabs.remove(${JSON.stringify(made.ids)}); await browser.contextualIdentities.remove(${JSON.stringify(made.container)}); })()`);
      }
    });
  }

  await run_case("tab list: A-u unloads the highlighted tab, keeps the list open, and A-u again loads it", async () => {
    const [tab_id] = await create_tabs(["p9u_target"]);
    const discarded = () => background(`browser.tabs.get(${tab_id}).then((tab) => tab.discarded)`);
    try {
      await open_line();
      await press_keys("tab p9u_target", "-k", "Down");
      await wait_cmdline((line) => line.selected !== null && shows_row("p9u_target")(line), "the p9u_target row to be highlighted");
      await press_keys(...ALT("u"));
      await poll_until("A-u to unload the highlighted tab", async () => (await discarded()) === true);
      await wait_cmdline(row_has_flag("p9u_target", "discarded"), "the list to show the unloaded flag");
      await press_keys(...ALT("u"));
      await poll_until("the second A-u to load the tab again, so the list was kept open", async () => (await discarded()) === false);
    } finally {
      await close_cmdline();
      await background(`browser.tabs.remove(${tab_id})`);
    }
  });

  await run_case("tab list: C-Space marks two tabs, A-m mutes them both, and the filter keeps the marks", async () => {
    const ids = await create_tabs(["p9s_one", "p9s_two"]);
    const muted = () => background(`Promise.all(${JSON.stringify(ids)}.map((id) => browser.tabs.get(id).then((tab) => tab.mutedInfo.muted)))`);
    try {
      await open_line();
      await press_keys("tab p9s_one", "-k", "Down");
      await wait_cmdline((line) => line.selected !== null && shows_row("p9s_one")(line), "the p9s_one row to be highlighted");
      await press_keys(...CTRL(" "));
      await wait_cmdline((line) => line.marked === 1, "the first tab to be marked");
      await press_keys(...CTRL("u"));
      await wait_cmdline((line) => line.value === "", "Ctrl-u to clear the line");
      await press_keys("tab p9s_two", "-k", "Down");
      await wait_cmdline((line) => line.selected !== null && shows_row("p9s_two")(line) && !shows_row("p9s_one")(line), "the p9s_two row to be highlighted alone");
      await press_keys(...CTRL(" "));
      await wait_cmdline((line) => line.marked === 1, "the second tab to be marked");
      await press_keys(...ALT("m"));
      await poll_until("A-m to mute both marked tabs", async () => (await muted()).every(Boolean));
      await wait_cmdline(row_has_flag("p9s_two", "muted"), "the list to show the muted flag");
      await press_keys(...ALT("m"));
      await poll_until("the second A-m to unmute both marked tabs", async () => (await muted()).every((value) => !value));
    } finally {
      await close_cmdline();
      await background(`browser.tabs.remove(${JSON.stringify(ids)})`);
    }
  });

  await run_case("tab list: the first Escape clears the marks and the line stays, A-x closes the marked tabs", async () => {
    const ids = await create_tabs(["p9x_one", "p9x_two"]);
    const open_count = () => background(`browser.tabs.query({}).then((tabs) => tabs.filter((tab) => ${JSON.stringify(ids)}.includes(tab.id)).length)`);
    try {
      await open_line();
      await press_keys("tab p9x_", "-k", "Down");
      await wait_cmdline((line) => line.selected !== null && shows_row("p9x_")(line), "a p9x_ row to be highlighted");
      await press_keys(...CTRL(" "));
      await wait_cmdline((line) => line.marked === 1, "the first tab to be marked");
      await press_keys(...CTRL(" "));
      await wait_cmdline((line) => line.marked === 2, "the second tab to be marked");
      await press_keys("-k", "Escape");
      await wait_cmdline((line) => line.open && line.marked === 0, "Escape to clear the marks and keep the line");
      await press_keys(...ALT("x"));
      await poll_until("A-x to close a tab", async () => (await open_count()) < 2);
      // The tab count read now could precede a late close of the second tab, which a lasting count rules out. No page event shows a tab close.
      await sleep(300);
      expect((await open_count()) === 1, `A-x after Escape did not close exactly the highlighted tab: ${await open_count()} of the 2 tabs stayed open, expected 1`);
    } finally {
      await close_cmdline();
      await background(`browser.tabs.remove(${JSON.stringify(ids)}).catch(() => {})`);
    }
  });

  await run_case("tab list: C-Space marks two tabs, A-c opens the container prompt, and Enter reopens them in that container", async () => {
    const made = await background(`(async () => {
      const fox = await browser.contextualIdentities.create({ name: "P9cWork", color: "orange", icon: "briefcase" });
      return { container: fox.cookieStoreId };
    })()`);
    made.ids = await create_tabs(["p9c_one", "p9c_two"]);
    const in_container = () => background(`browser.tabs.query({ cookieStoreId: ${JSON.stringify(made.container)} }).then((tabs) => tabs.filter((tab) => /p9c_/.test(tab.url)).length)`);
    const old_open = () => background(`browser.tabs.query({}).then((tabs) => tabs.filter((tab) => ${JSON.stringify(made.ids)}.includes(tab.id)).length)`);
    const line_tab = await background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.id)`);
    try {
      await open_line();
      await press_keys("tab p9c_", "-k", "Down");
      await wait_cmdline((line) => line.selected !== null && shows_row("p9c_")(line), "a p9c_ row to be highlighted");
      await press_keys(...CTRL(" "));
      await wait_cmdline((line) => line.marked === 1, "the first tab to be marked");
      await press_keys(...CTRL(" "));
      await wait_cmdline((line) => line.marked === 2, "the second tab to be marked");
      await press_keys(...ALT("c"));
      await wait_cmdline(shows_row("P9cWork"), "the container prompt to list P9cWork");
      await press_keys("-k", "Escape");
      await wait_cmdline((line) => line.open && shows_row("p9c_")(line) && line.marked === 2, "Escape to bring the tab list back with the marks");
      expect(await in_container() === 0 && await old_open() === 2, "Escape in the container prompt reopened tabs");
      await press_keys(...ALT("c"));
      await wait_cmdline(shows_row("P9cWork"), "the container prompt to list P9cWork again");
      await press_keys("p9cwork", "-k", "Tab");
      await wait_cmdline((line) => line.value === "P9cWork", "Tab to complete the container name");
      await press_keys("-k", "Return");
      await poll_until("Enter to reopen both marked tabs in the container", async () => (await in_container()) === 2, { timeout_ms: 8000 });
      await poll_until("the old tabs to close after the reopen", async () => (await old_open()) === 0);
      expect(await background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.id)`) === line_tab, "a reopened tab took the focus from the line's tab");
    } finally {
      await close_cmdline();
      await background(`(async () => {
        const tabs = await browser.tabs.query({ cookieStoreId: ${JSON.stringify(made.container)} });
        await browser.tabs.remove([...tabs.map((tab) => tab.id), ...${JSON.stringify(made.ids ?? [])}]).catch(() => {});
        await browser.contextualIdentities.remove(${JSON.stringify(made.container)});
      })()`);
    }
  });

  await run_case("tu unloads the current tab after switching to a loaded one", async () => {
    await open_page("page", "p9u_current", { new_tab: true });
    const tab_id = await background(`(async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].id)()`);
    await press_keys("tu");
    await poll_until("tu to unload the tab", async () => (await background(`browser.tabs.get(${tab_id}).then((tab) => tab.discarded)`)) === true);
    const after = await background(`browser.tabs.get(${tab_id}).then((tab) => ({ discarded: tab.discarded, active: tab.active }))`);
    await background(`browser.tabs.remove(${tab_id})`);
    expect(after.discarded === true, "tu did not unload the tab");
    expect(after.active === false, "tu left the unloaded tab active");
  });

  // Called straight on the browser, with the index tab.attach uses for a pinned tab: the end of the pinned tabs. Firefox ignores a move of a
  // pinned tab to index -1 and answers with no tab, so the pin must be kept by choosing an index inside the pinned area.
  await run_case("Firefox moves a pinned tab to the end of the pinned tabs of another window and keeps it pinned", async () => {
    await open_page("page", "p9e_attach", { new_tab: true });
    const moved = await background(`(async () => {
      const home = (await browser.windows.getLastFocused()).id;
      const [tab] = await browser.tabs.query({ active: true, windowId: home });
      await browser.tabs.update(tab.id, { pinned: true });
      const other = (await browser.windows.create({ url: "about:blank" })).id;
      const pinned_there = (await browser.tabs.query({ windowId: other, pinned: true })).length;
      await browser.tabs.move(tab.id, { windowId: other, index: pinned_there });
      const after = await browser.tabs.get(tab.id);
      await browser.windows.remove(other);
      await browser.windows.update(home, { focused: true });
      return { in_other_window: after.windowId === other, pinned: after.pinned };
    })()`);
    expect(moved.in_other_window, "the tab did not reach the other window");
    expect(moved.pinned, "the moved tab lost its pin");
  });
}
