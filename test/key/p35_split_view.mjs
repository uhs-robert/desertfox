// The gp and gP keys (other pane, swap panes) in a split view. The extension cannot create a split, so the piece opens one through chrome code, as the tab context menu does.
import { evaluate_in_background, evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["tabs", "keys"];

export async function run_cases({ rdp, extension_id, run_case, setup, expect, open_page, press_keys, settle_focus, wait_active_tab, poll_until }) {
  const split_ids = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({ currentWindow: true })).map((tab) => [tab.index, tab.splitViewId].join(":")).join(" "))()`);
  const places = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({ currentWindow: true })).sort((a, b) => a.index - b.index).map((tab) => tab.url.split("/").pop()).join(" "))()`);

  const activate_tail = async () => {
    await evaluate_in_background(rdp, extension_id, `(async () => { const [tail] = await browser.tabs.query({ currentWindow: true, url: "*://*/*p35_tail*" }); await browser.tabs.update(tail.id, { active: true }); })()`);
    await wait_active_tab("p35_tail", "the tail page to be active");
    await settle_focus();
  };

  await setup("open two pages and split them", async () => {
    await open_page("page", "p35_left", { new_tab: true });
    await open_page("page", "p35_right", { new_tab: true });
    await open_page("page", "p35_tail", { new_tab: true });
    await evaluate_in_chrome(rdp, `(() => { const g = Services.wm.getMostRecentWindow("navigator:browser").gBrowser; g.addTabSplitView(g.tabs.slice(-3, -1)); })()`);
    // Firefox puts the pair at the end of the strip, so the tail tab moves back behind it.
    await poll_until("the two tabs to share a split view", async () => /(\d+):([1-9]\d*) \d+:\2$/.test(await split_ids()));
    await evaluate_in_background(rdp, extension_id, `(async () => { const [tail] = await browser.tabs.query({ currentWindow: true, url: "*://*/*p35_tail*" }); await browser.tabs.move(tail.id, { index: -1 }); })()`);
    await poll_until("the tail tab to sit after the pair", async () => /^[\s\S]*(\d+):([1-9]\d*) \d+:\2 \d+:-1$/.test(await split_ids()));
    await evaluate_in_chrome(rdp, `(() => { const g = Services.wm.getMostRecentWindow("navigator:browser").gBrowser; g.selectedTab = g.tabs.at(-3); })()`);
  });

  await run_case("gp moves the focus to the other pane and back", async () => {
    const first = await wait_active_tab((page_id) => page_id === "p35_left" || page_id === "p35_right", "a split page to be active");
    const other = first === "p35_left" ? "p35_right" : "p35_left";
    await press_keys("gp");
    await wait_active_tab(other, `${other} to be the active tab after gp`);
    await settle_focus();
    await press_keys("gp");
    await wait_active_tab(first, `${first} to be the active tab after the second gp`);
    await settle_focus();
  });

  await run_case("gP swaps the two tabs and keeps the split", async () => {
    const before = await places();
    await press_keys("gP");
    await poll_until("the two split tabs to trade places", async () => {
      const after = await places();
      const [a, b, tail] = before.split(" ").slice(-3);
      return after === [...before.split(" ").slice(0, -3), b, a, tail].join(" ");
    });
    expect(/(\d+):([1-9]\d*) \d+:\2 \d+:-1$/.test(await split_ids()), "the swap ended the split");
  });

  await run_case("the move key moves the pair as a unit: one step right puts the tab after it in front", async () => {
    const [left, right, tail] = (await places()).split(" ").slice(-3);
    await press_keys(">>");
    await poll_until("the tab after the pair to move in front of it", async () => (await places()).split(" ").slice(-3).join(" ") === [tail, left, right].join(" "));
    expect(/(\d+):([1-9]\d*) \d+:\2$/.test(await split_ids()), "the move ended the split");
  });

  await run_case("the move key on the tab before the pair puts it after the pair", async () => {
    await activate_tail();
    const [tail, left, right] = (await places()).split(" ").slice(-3);
    await press_keys(">>");
    await poll_until("the tab to land after the pair", async () => (await places()).split(" ").slice(-3).join(" ") === [left, right, tail].join(" "));
  });

  await run_case("the move key on the tab after the pair puts it in front of the pair", async () => {
    await activate_tail();
    const [left, right, tail] = (await places()).split(" ").slice(-3);
    await press_keys("<<");
    await poll_until("the tab to land in front of the pair", async () => (await places()).split(" ").slice(-3).join(" ") === [tail, left, right].join(" "));
  });
}
