// Key test cases of piece P3 PR E (tab and bookmark completion). run.mjs calls run_cases with its helpers.
// The list sits in the extension-origin iframe, so the cases drive it with keys and check what the commands did.
import { evaluate_in_background } from "./rdp.mjs";

const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
const ALT = (key) => ["-M", "alt", key, "-m", "alt"];

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, events, expect, sleep, url_of, became_visible, take_shot }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);

  await open_page("page", "p9e_one", { new_tab: true });
  await open_page("page", "p9e_two", { new_tab: true });
  await open_page("page", "p9e_three", { new_tab: true });

  await run_case("tab, a typed name, Tab and Enter switch to that tab", async () => {
    await send_keys(":");
    await sleep(700);
    const mark = events.length;
    await send_keys("tab p9e_one", "-k", "Tab", "-k", "Return");
    await wait_event(mark, became_visible("p9e_one"), "tab p9e_one after the pick");
  });

  await run_case("a leading number picks the tab at that place of the tab bar", async () => {
    const tabs = await background(`(async () => (await browser.tabs.query({ currentWindow: true })).map((tab) => tab.url))()`);
    const place = tabs.findIndex((url) => url.includes("p9e_three")) + 1;
    expect(place > 0, "p9e_three is not in the window");
    await send_keys(":");
    await sleep(700);
    const mark = events.length;
    await send_keys(`tab ${place}`, "-k", "Return");
    await wait_event(mark, became_visible("p9e_three"), `tab p9e_three after "tab ${place}"`);
  });

  await run_case("the tabs list shows a tab created while the list is open, with no keypress", async () => {
    let live_id;
    let picked = false;
    try {
      await send_keys(":");
      await sleep(700);
      await send_keys("tab p9e_live");
      await sleep(300);
      // The list has no match yet. The model patch adds the row, and the pick below finds it.
      live_id = await background(`browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9e_live"))}, active: false }).then((tab) => tab.id)`);
      await sleep(1000);
      const mark = events.length;
      await send_keys("-k", "Tab", "-k", "Return");
      picked = true;
      await wait_event(mark, became_visible("p9e_live"), "the tab created under the open list");
    } finally {
      // A failed case must leave neither the tab nor the open line behind for the cases after it.
      if (live_id !== undefined) await background(`browser.tabs.remove(${live_id}).catch(() => {})`);
      if (!picked) {
        await send_keys("-k", "Escape");
        await sleep(200);
        await send_keys("-k", "Escape");
      }
      await sleep(500);
    }
  });

  await run_case("bookmark -t lists the bookmarks, and a pick opens it in a new tab", async () => {
    await background(`browser.bookmarks.create({ title: "P9e Zeta bookmark", url: ${JSON.stringify(url_of("page", "p9e_mark"))} })`);
    await send_keys(":");
    await sleep(700);
    const mark = events.length;
    await send_keys("bookmark -t zeta", "-k", "Tab", "-k", "Return");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9e_mark", "the bookmarked page in a new tab");
    await send_keys(...CTRL("w"));
    await sleep(500);
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
    const tab_id = await background(`(async () => (await browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9u_target"))}, active: false })).id)()`);
    const discarded = () => background(`browser.tabs.get(${tab_id}).then((tab) => tab.discarded)`);
    try {
      await sleep(1200);
      await send_keys(":");
      await sleep(700);
      await send_keys("tab p9u_target", "-k", "Down");
      await sleep(400);
      await send_keys(...ALT("u"));
      await sleep(800);
      expect(await discarded() === true, "A-u did not unload the highlighted tab");
      await send_keys(...ALT("u"));
      await sleep(800);
      expect(await discarded() === false, "the second A-u did not load the tab again, so the list was not kept open");
    } finally {
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys("-k", "Escape");
      await sleep(400);
      await background(`browser.tabs.remove(${tab_id})`);
    }
  });

  await run_case("tab list: C-Space marks two tabs, A-m mutes them both, and the filter keeps the marks", async () => {
    const ids = await background(`(async () => [
      (await browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9s_one"))}, active: false })).id,
      (await browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9s_two"))}, active: false })).id,
    ])()`);
    const muted = () => background(`Promise.all(${JSON.stringify(ids)}.map((id) => browser.tabs.get(id).then((tab) => tab.mutedInfo.muted)))`);
    try {
      await sleep(1200);
      await send_keys(":");
      await sleep(700);
      await send_keys("tab p9s_one", "-k", "Down");
      await send_keys(...CTRL(" "));
      await send_keys(...CTRL("u"));
      await send_keys("tab p9s_two", "-k", "Down");
      await send_keys(...CTRL(" "));
      await sleep(300);
      await send_keys(...ALT("m"));
      await sleep(800);
      expect((await muted()).every(Boolean), "A-m did not mute both marked tabs");
      await send_keys(...ALT("m"));
      await sleep(800);
      expect((await muted()).every((value) => !value), "the second A-m did not unmute both marked tabs");
    } finally {
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys("-k", "Escape");
      await sleep(400);
      await background(`browser.tabs.remove(${JSON.stringify(ids)})`);
    }
  });

  await run_case("tab list: the first Escape clears the marks and the line stays, A-x closes the marked tabs", async () => {
    const ids = await background(`(async () => [
      (await browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9x_one"))}, active: false })).id,
      (await browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9x_two"))}, active: false })).id,
    ])()`);
    const open_count = () => background(`browser.tabs.query({}).then((tabs) => tabs.filter((tab) => ${JSON.stringify(ids)}.includes(tab.id)).length)`);
    try {
      await sleep(1200);
      await send_keys(":");
      await sleep(700);
      await send_keys("tab p9x_", "-k", "Down");
      await send_keys(...CTRL(" "));
      await send_keys(...CTRL(" "));
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys(...ALT("x"));
      await sleep(800);
      expect(await open_count() === 1, "A-x after Escape closed more than the highlighted tab, so Escape did not clear the marks");
    } finally {
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys("-k", "Escape");
      await sleep(400);
      await background(`browser.tabs.remove(${JSON.stringify(ids)}).catch(() => {})`);
    }
  });

  await run_case("tab list: C-Space marks two tabs, A-c opens the container prompt, and Enter reopens them in that container", async () => {
    const made = await background(`(async () => {
      const fox = await browser.contextualIdentities.create({ name: "P9cWork", color: "orange", icon: "briefcase" });
      const ids = [
        (await browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9c_one"))}, active: false })).id,
        (await browser.tabs.create({ url: ${JSON.stringify(url_of("page", "p9c_two"))}, active: false })).id,
      ];
      return { ids, container: fox.cookieStoreId };
    })()`);
    const in_container = () => background(`browser.tabs.query({ cookieStoreId: ${JSON.stringify(made.container)} }).then((tabs) => tabs.filter((tab) => /p9c_/.test(tab.url)).length)`);
    const old_open = () => background(`browser.tabs.query({}).then((tabs) => tabs.filter((tab) => ${JSON.stringify(made.ids)}.includes(tab.id)).length)`);
    try {
      await sleep(1200);
      await send_keys(":");
      await sleep(700);
      await send_keys("tab p9c_", "-k", "Down");
      await send_keys(...CTRL(" "));
      await send_keys(...CTRL(" "));
      await send_keys(...ALT("c"));
      await sleep(400);
      await send_keys("-k", "Escape");
      await sleep(300);
      expect(await in_container() === 0 && await old_open() === 2, "Escape in the container prompt reopened tabs");
      await send_keys(...ALT("c"));
      await sleep(400);
      await send_keys("p9cwork", "-k", "Tab");
      await send_keys("-k", "Return");
      await sleep(1500);
      expect(await in_container() === 2, "Enter did not reopen both marked tabs in the container");
      expect(await old_open() === 0, "the old tabs stayed open after the reopen");
    } finally {
      await send_keys("-k", "Escape");
      await sleep(300);
      await send_keys("-k", "Escape");
      await sleep(400);
      await background(`(async () => {
        const tabs = await browser.tabs.query({ cookieStoreId: ${JSON.stringify(made.container)} });
        await browser.tabs.remove([...tabs.map((tab) => tab.id), ...${JSON.stringify(made.ids)}]).catch(() => {});
        await browser.contextualIdentities.remove(${JSON.stringify(made.container)});
      })()`);
    }
  });

  await run_case("tu unloads the current tab after switching to a loaded one", async () => {
    await open_page("page", "p9u_current", { new_tab: true });
    const tab_id = await background(`(async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].id)()`);
    await send_keys("tu");
    await sleep(1200);
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
    await sleep(500);
    expect(moved.in_other_window, "the tab did not reach the other window");
    expect(moved.pinned, "the moved tab lost its pin");
  });

  for (let closed = 0; closed < 3; closed++) {
    await send_keys(...CTRL("w"));
    await sleep(700);
  }
}
