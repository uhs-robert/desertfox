// Tab range mode (gv, page route). Firefox's tab multiselection is the display: the active tab is the anchor and is always in it. j, k, gg and G move the other end through the strip in order. The action keys act on the range and end it. Escape, a tab switch and a navigation of the active tab end it.
import { evaluate_in_background, evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["tabs", "keys", "bundles", "ui"];

const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;

export async function run_cases({ rdp, extension_id, run_case, setup, press_keys, open_page, poll_until, settle_focus, expect, in_active_tab, sleep, events, wait_event, barrier }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const expect_badge = (label) => poll_until(`the ${label} badge`, async () => (await badge()) === label);
  const strip = () => background(`(async () => (await browser.tabs.query({ currentWindow: true })).map((tab) => ({ id: tab.id, index: tab.index, active: tab.active, highlighted: tab.highlighted, pinned: tab.pinned, muted: tab.mutedInfo.muted, hidden: !!tab.hidden, group: tab.groupId })))()`);
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.textContent ?? ""`);
  const urls_of = (tab_ids) => background(`Promise.all(${JSON.stringify(tab_ids)}.map((id) => browser.tabs.get(id).then((tab) => tab.url)))`);
  const highlighted_ids = async () => (await strip()).filter((tab) => tab.highlighted).map((tab) => tab.id);
  const active_id = async () => (await strip()).find((tab) => tab.active).id;
  const expect_highlighted = (wanted, what) => poll_until(what, async () => JSON.stringify(await highlighted_ids()) === JSON.stringify(wanted));
  // Presses a motion key and waits until the selection holds that many tabs, so an action key never beats the move.
  const grow = async (keys, size) => {
    await press_keys(keys);
    try {
      await poll_until(`a range of ${size} tabs`, async () => (await highlighted_ids()).length === size);
    } catch (error) {
      throw new Error(`${error.message} (badge ${await badge()}, strip ${JSON.stringify(await strip())})`);
    }
  };
  const activate = async (id) => {
    await background(`browser.tabs.update(${id}, { active: true }).then(() => 0)`);
    await poll_until(`tab ${id} active`, async () => (await active_id()) === id);
    await settle_focus();
  };
  // Puts the strip back as the setup left it: nothing pinned, muted or grouped, the tabs in their first order, one tab selected, NORMAL mode.
  const fresh = async (anchor) => {
    await background(`(async () => {
      const tabs = await browser.tabs.query({ currentWindow: true });
      for (const tab of tabs) {
        if (tab.pinned) await browser.tabs.update(tab.id, { pinned: false });
        if (tab.mutedInfo.muted) await browser.tabs.update(tab.id, { muted: false });
      }
      const grouped = tabs.filter((tab) => tab.groupId !== -1).map((tab) => tab.id);
      if (grouped.length > 0) await browser.tabs.ungroup(grouped);
      await browser.tabs.move(${JSON.stringify(ids)}, { index: -1 });
      return 0;
    })()`);
    await activate(anchor);
    await background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); await browser.tabs.highlight({ windowId: tab.windowId, tabs: [tab.index] }); return 0; })()`);
    if ((await badge()) !== "NORMAL") await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await expect_highlighted([anchor], "one tab selected");
  };
  // Opens n tabs after the current one, the last of them active, and answers the ids of the whole strip in order.
  const make_strip = async (name, count) => {
    for (let at = 0; at < count; at++) await open_page("page", `${name}_${at}`, { new_tab: true });
    return (await strip()).map((tab) => tab.id);
  };


  let ids;
  await setup("open a strip of six tabs and make the third active", async () => {
    ids = await make_strip("p57", 6);
    await activate(ids.at(-4));
  });

  // Measured on the page route: tabs.highlight with the active tab first causes no tab switch.
  await run_case("probe: tabs.highlight with the active tab first selects the range and fires no onActivated", async () => {
    const result = await background(`(async () => {
      let activated = 0;
      const count = () => void activated++;
      browser.tabs.onActivated.addListener(count);
      const all = await browser.tabs.query({ currentWindow: true });
      const active = all.find((tab) => tab.active);
      const rest = all.filter((tab) => tab.index > active.index && tab.index <= active.index + 2).map((tab) => tab.index);
      await browser.tabs.highlight({ windowId: active.windowId, tabs: [active.index, ...rest] });
      await new Promise((resolve) => setTimeout(resolve, 300));
      browser.tabs.onActivated.removeListener(count);
      const after = await browser.tabs.query({ currentWindow: true });
      const selected = after.filter((tab) => tab.highlighted).map((tab) => tab.index);
      await browser.tabs.highlight({ windowId: active.windowId, tabs: [active.index] });
      return { activated, selected, expected: [active.index, ...rest].sort((a, b) => a - b), still_active: after.find((tab) => tab.active).id === active.id };
    })()`);
    expect(result.activated === 0, `highlight fired onActivated ${result.activated} times`);
    expect(result.still_active, "the active tab changed");
    expect(JSON.stringify(result.selected) === JSON.stringify(result.expected), `selected ${result.selected}, wanted ${result.expected}`);
  });

  // Measured: Firefox lists the tabs of a collapsed group like any other, so the range has to skip them itself.
  await run_case("probe: a collapsed group keeps its tabs in tabs.query, not hidden, and j steps over them to the tab after it", async () => {
    const before = await strip();
    const [first, second, third, after] = [ids[3], ids[4], ids[5], ids[6]];
    await background(`(async () => { const group = await browser.tabs.group({ tabIds: [${second}, ${third}] }); await browser.tabGroups.update(group, { collapsed: true }); })()`);
    const collapsed = (await strip()).filter((tab) => tab.id === second || tab.id === third);
    expect(collapsed.length === 2 && collapsed.every((tab) => !tab.hidden), `a collapsed group's tabs left tabs.query or report hidden: ${JSON.stringify(collapsed)}`);
    await activate(first);
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await press_keys("j");
    await expect_highlighted([first, after], "the tab after the group joins and the group's tabs stay out");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await background(`(async () => { const group = (await browser.tabs.get(${second})).groupId; await browser.tabs.ungroup([${second}, ${third}]); })()`);
    expect(before.length === (await strip()).length, "the strip changed size");
    await activate(ids.at(-4));
  });

  await run_case("gv drops a mouse selection and shows the TAB VISUAL badge, and j, k, gg and G move the far end while the active tab stays", async () => {
    const anchor = ids.at(-4);
    await background(`(async () => { const tabs = await browser.tabs.query({ currentWindow: true }); const active = tabs.find((tab) => tab.active); await browser.tabs.highlight({ windowId: active.windowId, tabs: [active.index, 0] }); return 0; })()`);
    await expect_highlighted([ids[0], anchor], "the mouse selection before gv");
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await expect_highlighted([anchor], "only the anchor selected at the start");
    await press_keys("j");
    await expect_highlighted([anchor, ids.at(-3)], "the next tab joins");
    await press_keys("j");
    await expect_highlighted([anchor, ids.at(-3), ids.at(-2)], "the second next tab joins");
    await press_keys("k");
    await expect_highlighted([anchor, ids.at(-3)], "k shrinks the range");
    await press_keys("kk");
    await expect_highlighted([ids.at(-5), anchor], "crossing the anchor moves the range to the other side");
    await press_keys("gg");
    await poll_until("gg reaches the first tab", async () => (await highlighted_ids()).includes(ids[0]));
    await press_keys("G");
    await poll_until("G reaches the last tab", async () => (await highlighted_ids()).includes(ids.at(-1)));
    expect((await active_id()) === anchor, "the active tab changed");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await expect_highlighted([anchor], "Escape clears the range");
  });

  await run_case("p pins the range in strip order and ends the mode, and a second round unpins it in the same order", async () => {
    const anchor = ids.at(-4);
    const pair = [anchor, ids.at(-3)];
    const expected_order = [...pair, ...ids.filter((id) => !pair.includes(id))];
    const order = async () => (await strip()).map((tab) => tab.id);
    await fresh(anchor);
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("p");
    await poll_until("both tabs pinned", async () => (await strip()).filter((tab) => tab.pinned).length === 2);
    expect(JSON.stringify(await order()) === JSON.stringify(expected_order), `the pinned order is ${await order()}, wanted ${expected_order}`);
    await expect_badge("NORMAL");
    await poll_until("one tab selected", async () => (await highlighted_ids()).length === 1);
    expect((await active_id()) === anchor, "the active tab changed");
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("p");
    await poll_until("the pins gone", async () => (await strip()).filter((tab) => tab.pinned).length === 0);
    expect(JSON.stringify(await order()) === JSON.stringify(expected_order), `the unpinned order is ${await order()}, wanted ${expected_order}`);
    await expect_badge("NORMAL");
  });

  await run_case("yy copies the range as a Markdown list and ends the mode", async () => {
    const pair = [ids.at(-4), ids.at(-3)];
    await fresh(pair[0]);
    await evaluate_in_chrome(rdp, `Services.clipboard.emptyClipboard(Services.clipboard.kGlobalClipboard)`);
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("yy");
    const urls = await urls_of(pair);
    await poll_until("the clipboard to hold both addresses as Markdown links", async () => {
      const lines = (await evaluate_in_chrome(rdp, clipboard_text)).split("\n").filter((line) => line !== "");
      return lines.length === 2 && lines.every((line, at) => line.startsWith("- [") && line.endsWith(`(${urls[at]})`));
    });
    await expect_badge("NORMAL");
  });

  await run_case("b bookmarks every tab of the range and ends the mode", async () => {
    const pair = [ids.at(-4), ids.at(-3)];
    await fresh(pair[0]);
    const urls = await urls_of(pair);
    const bookmarked = () => background(`Promise.all(${JSON.stringify(urls)}.map((url) => browser.bookmarks.search({ url }).then((nodes) => nodes.length)))`);
    expect((await bookmarked()).every((count) => count === 0), "a tab of the range had a bookmark before b");
    try {
      await press_keys("gv");
      await expect_badge("TAB VISUAL");
      await grow("j", 2);
      await press_keys("b");
      await poll_until("both tabs bookmarked", async () => (await bookmarked()).every((count) => count === 1));
      await expect_badge("NORMAL");
    } finally {
      await background(`Promise.all(${JSON.stringify(urls)}.map((url) => browser.bookmarks.search({ url }).then((nodes) => Promise.all(nodes.map((node) => browser.bookmarks.remove(node.id)))))).then(() => 0)`);
    }
  });

  await run_case("m mutes the range", async () => {
    await fresh(ids.at(-4));
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("m");
    await poll_until("both tabs muted", async () => (await strip()).filter((tab) => tab.muted).length === 2);
    await expect_badge("NORMAL");
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("m");
    await poll_until("the mutes gone", async () => (await strip()).filter((tab) => tab.muted).length === 0);
  });

  await run_case("r reloads every tab of the range", async () => {
    await fresh(ids.at(-4));
    const wanted = [ids.at(-4), ids.at(-3)];
    for (const id of wanted) await background(`browser.tabs.executeScript(${id}, { code: "document.documentElement.dataset.p57 = 'old'" }).then(() => 0)`);
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("r");
    for (const id of wanted) await poll_until(`tab ${id} reloaded`, async () => (await background(`browser.tabs.executeScript(${id}, { code: "document.documentElement.dataset.p57 ?? 'none'" }).then((result) => result[0])`)) === "none");
    await settle_focus();
    await expect_badge("NORMAL");
  });

  await run_case("J inside the range ends it and lands on the next tab, which the end does not undo", async () => {
    const anchor = ids.at(-4);
    await fresh(anchor);
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("J");
    await poll_until("the next tab active", async () => (await active_id()) === ids.at(-3));
    await sleep(500);
    expect((await active_id()) === ids.at(-3), "the active tab went back");
    await settle_focus();
    await expect_badge("NORMAL");
  });

  await run_case("ga puts the range in one new group and ends the mode", async () => {
    await fresh(ids.at(-4));
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("j", 2);
    await press_keys("ga");
    await poll_until("both tabs in one group", async () => {
      const grouped = (await strip()).filter((tab) => tab.group !== -1);
      return grouped.length === 2 && grouped[0].group === grouped[1].group;
    });
    await expect_badge("NORMAL");
    await background(`browser.tabs.ungroup([${ids.at(-4)}, ${ids.at(-3)}]).then(() => 0)`);
  });

  await run_case("a tab switch ends the mode and the range", async () => {
    await fresh(ids.at(-4));
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("jj", 3);
    await background(`browser.tabs.update(${ids[0]}, { active: true }).then(() => 0)`);
    await poll_until("the first tab active", async () => (await active_id()) === ids[0]);
    await expect_highlighted([ids[0]], "the range gone after the switch");
    await settle_focus();
    await expect_badge("NORMAL");
  });

  // Q is no key to test with: the key-test config binds `Qabc` in normal mode, so Q waits as a prefix there and in this mode. The control press in normal mode shows the key reaches this page at all. The barrier after the badge waits out any bundle load the mode started, so the presses after it test the mode alone.
  await run_case("a key with no binding reaches the page in normal mode and in the mode, and keeps the mode", async () => {
    const anchor = ids.at(-4);
    await fresh(anchor);
    const page_id = await in_active_tab(`new URLSearchParams(location.search).get("id")`);
    const reaches_page = async (key) => {
      const mark = events.length;
      await press_keys(key);
      try {
        await wait_event(mark, (event) => event.type === "keydown" && event.key === key, `${key} on the page`, 2000);
        return true;
      } catch {
        return false;
      }
    };
    const in_normal = { equals: await reaches_page("="), tilde: await reaches_page("~") };
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await barrier(page_id);
    const in_mode = { equals: await reaches_page("="), tilde: await reaches_page("~") };
    expect([...Object.values(in_normal), ...Object.values(in_mode)].every(Boolean), `a key missed the page: ${JSON.stringify({ in_normal, in_mode })}`);
    await expect_badge("TAB VISUAL");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
  });

  await run_case("d closes the range and moves focus to the nearest tab outside it", async () => {
    await fresh(ids.at(-4));
    const nearest_outside = ids.at(-5);
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await grow("jj", 3);
    await press_keys("d");
    await poll_until("the range closed", async () => (await strip()).length === ids.length - 3);
    const left = (await strip()).map((tab) => tab.id);
    expect(!left.includes(ids.at(-4)) && !left.includes(ids.at(-2)), "a tab of the range is still open");
    expect((await active_id()) === nearest_outside, `the active tab is ${await active_id()}, wanted ${nearest_outside}`);
    await settle_focus();
    await expect_badge("NORMAL");
  });

  await run_case("d refuses a range of more than ten tabs, names the count and D, keeps the range, and D closes it", async () => {
    await open_page("page", "p57_big_0", { new_tab: true });
    for (let at = 1; at < 12; at++) await background(`browser.tabs.create({ url: ${JSON.stringify(`about:blank#${at}`)}, active: false }).then(() => 0)`);
    const all = (await strip()).map((tab) => tab.id);
    await activate(all[1]);
    await press_keys("gv");
    await expect_badge("TAB VISUAL");
    await press_keys("G");
    await poll_until("every tab but the first selected", async () => (await highlighted_ids()).length === all.length - 1);
    await press_keys("d");
    const wanted = new RegExp(`Refused to close ${all.length - 1} tabs.*Press D`);
    await poll_until("the refusal toast to name the count and D", async () => wanted.test(await toast_text()));
    expect((await strip()).length === all.length, "tabs closed over the limit");
    await expect_badge("TAB VISUAL");
    await press_keys("D");
    await poll_until("the range closed", async () => (await strip()).length === 1);
  });
}
