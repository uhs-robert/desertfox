// Visual item mode, entered with v in item mode. v, V and Escape return to item mode and a second Escape goes to normal mode. Every other key of item mode ends the selection and runs as in item mode: f, J, gt and the command line, also after a config reload rebinds the item key. The cursor keys move the end of the selection and o swaps the ends. The selection follows its items when the page draws the list again: every node replaced, an end removed, every item removed. The tab holds the mode: a second frame stays in item mode, and a frame that reloads joins as item mode.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "tabs", "bundles"];
export async function run_cases({ run_line, config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, in_background, hint_label_count, wait_active_tab, open_cmdline, close_cmdline, poll_until, expect, sleep }) {
  const row_config = () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=iv_row_*"', 'keymap = { item = { j = "page.item --direction=down div.card.even" } }', ""].join("\n"));
    return dir;
  };
  await setup("bind j on the iv_row_ pages to the even cards, which the finder does not single out", async () => {
    await load_config_dir(row_config());
  });

  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const expect_badge = (label) => poll_until(`the ${label} badge`, async () => (await badge()) === label);
  // The badge of a tab that is not the active one, found by its page id.
  const badge_in_tab_of = (page_id) => in_background(`(async () => { const [tab] = (await browser.tabs.query({})).filter((tab) => tab.url.includes(${JSON.stringify(`id=${page_id}`)})); return (await browser.tabs.executeScript(tab.id, { code: 'document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null' }))[0]; })()`);
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  // The badge says how many items the range holds.
  const expect_range = (count) => expect_badge(`VISUAL ${count}`);
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
  const focus_frame = () => in_active_tab(`document.getElementById("inner").contentWindow.focus(); 0`);
  const frame_focused = () => in_active_tab(`document.getElementById("inner").contentDocument.activeElement?.id ?? ""`);
  // The page draws its cards again with these card numbers, and the test waits for the draw.
  const draw = async (numbers) => {
    const before = Number(await in_active_tab(`document.documentElement.dataset.drawn`));
    await in_active_tab(`document.documentElement.dataset.draw = ${JSON.stringify(numbers.join(","))}; 0`);
    await poll_until("the list drawn again", async () => Number(await in_active_tab(`document.documentElement.dataset.drawn`)) > before);
  };
  // Picks the list with I, which lands on the first card, then starts the selection there.
  const start = async (id) => {
    await open_page("item_list", id, { new_tab: true });
    await press_keys("I");
    await expect_badge("ITEM");
    await expect_focus("c0");
    await press_keys("v");
    await expect_range(1);
  };

  await run_case("v enters visual item mode, v returns to item mode, and Escape goes to item mode and then to normal mode", async () => {
    await start("iv_modes_dyn");
    await press_keys("v");
    await expect_badge("ITEM");
    await press_keys("v");
    await expect_range(1);
    await press_keys("-k", "Escape");
    await expect_badge("ITEM");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
  });

  await run_case("the cursor keys move the focus, and o swaps the ends so the cursor grows the range the other way", async () => {
    await start("iv_move_dyn");
    await press_keys("jj");
    await expect_focus("c2");
    await expect_range(3);
    await press_keys("k");
    await expect_focus("c1");
    await expect_range(2);
    await press_keys("j", "j");
    await expect_focus("c3");
    await expect_range(4);
    await press_keys("o");
    await expect_focus("c0");
    await expect_range(4);
    await press_keys("j");
    await expect_focus("c1");
    await expect_range(3);
  });

  await run_case("the cursor goes on from its item when the page replaces every card", async () => {
    await start("iv_same_dyn");
    await press_keys("jj");
    await expect_focus("c2");
    await draw([0, 1, 2, 3, 4, 5, 6, 7]);
    await expect_range(3);
    await press_keys("j");
    await expect_focus("c3");
    await expect_range(4);
  });

  await run_case("the cursor takes its neighbour when the page removes its card, and so does the anchor", async () => {
    await start("iv_cursor_gone_dyn");
    await press_keys("jj");
    await expect_focus("c2");
    await draw([0, 1, 3, 4, 5, 6, 7]);
    await press_keys("j");
    await expect_focus("c4");
    await expect_range(4);
    await draw([1, 3, 4, 5, 6, 7]);
    await expect_range(3);
    await press_keys("j");
    await expect_focus("c5");
    await expect_range(4);
  });

  await run_case("without a link address on each card the selection follows data-id", async () => {
    await start("iv_data_id_dynbare");
    await press_keys("jj");
    await expect_focus("c2");
    await draw([0, 1, 2, 3, 4, 5, 6, 7]);
    await press_keys("j");
    await expect_focus("c3");
    await expect_range(4);
  });

  await run_case("when the page removes every card the mode returns to item mode with a notice", async () => {
    await start("iv_all_gone_dyn");
    await press_keys("j");
    await draw([]);
    await expect_badge("ITEM");
    await poll_until("the notice", async () => (await toast_text()).includes("Selection gone"));
  });

  await run_case("a second frame stays in item mode while the list frame is in visual item mode, and Escape in it ends both", async () => {
    await open_page("item_list", "iv_frame_frame", { new_tab: true });
    await poll_until("the frame to load", async () => (await in_active_tab(`document.getElementById("inner").contentDocument.readyState`)) === "complete");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
    await press_keys("v");
    await expect_range(1);
    await focus_frame();
    await expect_badge("ITEM");
    await press_keys("j");
    await poll_until("focus in the frame", async () => (await frame_focused()) === "f0");
    await press_keys("-k", "Escape");
    await expect_badge("FRAME");
    await in_active_tab(`window.focus(); document.activeElement?.blur(); 0`);
    await expect_badge("NORMAL");
  });

  // Each frame sends the size of its own range. The top frame keeps one per frame, so the badge shows the range of the frame with the focus.
  await run_case("the badge shows the range of the frame that holds the focus, not the one changed last", async () => {
    await open_page("item_list", "iv_count_frame_frame", { new_tab: true });
    await poll_until("the frame to load", async () => (await in_active_tab(`document.getElementById("inner").contentDocument.readyState`)) === "complete");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
    await press_keys("v");
    await expect_range(1);
    await focus_frame();
    await expect_badge("ITEM");
    await press_keys("j");
    await poll_until("focus in the frame", async () => (await frame_focused()) === "f0");
    await press_keys("v");
    await expect_range(1);
    await press_keys("j");
    await expect_range(2);
    await in_active_tab(`window.focus(); document.activeElement?.blur(); 0`);
    await expect_range(1);
  });

  await run_case("a frame that reloads joins the hold as item mode", async () => {
    await open_page("item_list", "iv_reload_frame_frame", { new_tab: true });
    await poll_until("the frame to load", async () => (await in_active_tab(`document.getElementById("inner").contentDocument?.readyState`)) === "complete");
    await focus_frame();
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("j");
    await poll_until("focus in the frame", async () => (await frame_focused()) === "f0");
    await press_keys("v");
    await expect_range(1);
    await press_keys("j");
    await expect_range(2);
    await in_active_tab(`(() => { const inner = document.getElementById("inner").contentWindow; inner.old_document = true; inner.location.reload(); return 0; })()`);
    await poll_until("the frame to load again", async () => (await in_active_tab(`(() => { const inner = document.getElementById("inner").contentWindow; return !inner.old_document && inner.document.readyState; })()`)) === "complete");
    await focus_frame();
    await sleep(500);
    await expect_badge("ITEM");
  });

  const checked_boxes = async () => JSON.parse(await in_active_tab(`JSON.stringify([...document.querySelectorAll("#dyn input:checked")].map((box) => box.id))`));
  const expect_checked = (ids) => poll_until(`boxes ${ids.join(",") || "none"} checked`, async () => (await checked_boxes()).join(",") === ids.join(","));

  await run_case("Space sets every checkbox of the range to the opposite of the anchor's, and says how many it changed", async () => {
    await start("iv_space_dyn");
    await press_keys("jj");
    await expect_range(3);
    await press_keys("-k", "space");
    await expect_checked(["x0", "x1", "x2"]);
    await poll_until("the count", async () => (await toast_text()).includes("3 changed"));
    // The anchor is checked now, so the next Space clears the range, and the mode stays.
    await press_keys("-k", "space");
    await expect_checked([]);
    await expect_range(3);
  });

  await run_case("a mixed range goes to the opposite of the anchor's state, whichever end the cursor is", async () => {
    await start("iv_mixed_dyn");
    await in_active_tab(`document.getElementById("x1").checked = true; document.getElementById("x3").checked = true; 0`);
    await press_keys("jjj");
    await expect_range(4);
    await press_keys("-k", "space");
    await expect_checked(["x0", "x1", "x2", "x3"]);
    // Swap the ends: the anchor is x3 now, still checked, so the range clears.
    await press_keys("o");
    await expect_focus("c0");
    await press_keys("-k", "space");
    await expect_checked([]);
  });

  await run_case("an item with no checkbox is skipped, and an anchor with none refuses", async () => {
    await start("iv_nobox_dyn_nobox");
    await press_keys("jjj");
    await expect_range(4);
    await press_keys("-k", "space");
    await expect_checked(["x0", "x1", "x3"]);
    await poll_until("the count", async () => (await toast_text()).includes("3 changed"));
    await press_keys("v");
    await expect_badge("ITEM");
    await press_keys("k");
    await expect_focus("c2");
    await press_keys("v");
    await expect_range(1);
    await press_keys("j");
    await expect_range(2);
    await press_keys("-k", "space");
    await poll_until("the notice", async () => (await toast_text()).includes("No checkbox in the anchor item"));
    await expect_checked(["x0", "x1", "x3"]);
  });

  await run_case("a page that draws its list again on each click still gets every box of the range set", async () => {
    await start("iv_redraw_dyn_redraw");
    await press_keys("jjj");
    await expect_range(4);
    await press_keys("-k", "space");
    await expect_checked(["x0", "x1", "x2", "x3"]);
  });

  await run_case("visual item mode walks the items of the site row, not the finder's list, and Space acts on them only", async () => {
    await open_page("item_list", "iv_row_dyn_even", { new_tab: true });
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
    await press_keys("v");
    await expect_range(1);
    await press_keys("j");
    await expect_focus("c2");
    await expect_range(2);
    await press_keys("o");
    await expect_focus("c0");
    await expect_range(2);
    await press_keys("-k", "space");
    await expect_checked(["x0", "x2"]);
  });

  await run_case("a click that removes its row does not make Space skip the next row of the range", async () => {
    await start("iv_vanish_dyn_vanish");
    await press_keys("jjj");
    await expect_range(4);
    await press_keys("-k", "space");
    await poll_until("the count", async () => (await toast_text()).includes("4 changed"));
    expect((await in_active_tab(`[...document.querySelectorAll("#dyn .card a")].map((link) => link.id).join(",")`)) === "c4,c5,c6,c7,c8,c9,c10,c11", "a row was skipped");
  });

  await run_case("a vanishing row on a list told apart by place only still gets every box of the range set", async () => {
    await start("iv_place_dyn_dynbare_noid_vanish");
    await press_keys("jjj");
    await expect_range(4);
    await press_keys("-k", "space");
    await poll_until("the count", async () => (await toast_text()).includes("4 changed"));
    expect((await in_active_tab(`[...document.querySelectorAll("#dyn .card a")].map((link) => link.id).join(",")`)) === "c4,c5,c6,c7,c8,c9,c10,c11", "a row was skipped or one outside the range was clicked");
  });

  await run_case("V ends the selection as v does", async () => {
    await start("iv_shift_v_dyn");
    await press_keys("j");
    await expect_range(2);
    await press_keys("V");
    await expect_badge("ITEM");
    await expect_focus("c1");
  });

  await run_case("f leaves the selection, then shows the hints, and Escape returns to item mode", async () => {
    await start("iv_hint_dyn");
    await press_keys("jj");
    await expect_range(3);
    await press_keys("f");
    await poll_until("the hint labels", async () => (await hint_label_count()) > 1);
    expect(!(await badge())?.startsWith("VISUAL"), "the badge still says VISUAL under the hints");
    await press_keys("-k", "Escape");
    await expect_badge("ITEM");
    await poll_until("no hint labels", async () => (await hint_label_count()) === 0);
    // Item mode goes on from the cursor, with no range.
    await press_keys("j");
    await expect_focus("c3");
    await expect_badge("ITEM");
  });

  await run_case("gt shares the g group with the own gg: gg still extends, and gt ends the selection and goes to the next tab", async () => {
    await start("iv_gt_dyn");
    await press_keys("jjj");
    await expect_range(4);
    await press_keys("gg");
    await expect_focus("c0");
    await expect_range(1);
    await press_keys("jj");
    await expect_range(3);
    await press_keys("gt");
    await wait_active_tab((page_id) => page_id !== "iv_gt_dyn", "another tab to be active");
    const mode_there = await badge_in_tab_of("iv_gt_dyn");
    expect(mode_there === "ITEM", `the list tab is in ${mode_there}, not item mode`);
  });

  // J runs in the background, so the page sends the whole leaf to the router, which sends the step back to item mode to the page before it switches the tab.
  await run_case("J, a background key, ends the selection in the page and goes to the next tab", async () => {
    await start("iv_tab_dyn");
    await press_keys("j");
    await expect_range(2);
    await press_keys("J");
    await wait_active_tab((page_id) => page_id !== "iv_tab_dyn", "another tab to be active");
    const mode_there = await badge_in_tab_of("iv_tab_dyn");
    expect(mode_there === "ITEM", `the list tab is in ${mode_there}, not item mode`);
  });

  await run_case("the command line opens from visual item mode, and closing it returns to item mode", async () => {
    await start("iv_cmdline_dyn");
    await press_keys("j");
    await expect_range(2);
    await open_cmdline();
    await close_cmdline();
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c2");
  });

  await run_case("I in visual item mode ends the selection and picks the list in item mode", async () => {
    await start("iv_pick_dyn");
    await press_keys("jj");
    await expect_focus("c2");
    await press_keys("I");
    await expect_badge("ITEM");
    // The pick lands on the item a move would start from, which is where the cursor was.
    await expect_focus("c2");
    await press_keys("j");
    await expect_focus("c3");
  });

  // The hashes of the tabs on a page, here included. The test page's cards link to #c<n> on the same address.
  const background_hashes = (page_id) => in_background(`(async () => (await browser.tabs.query({})).filter((tab) => tab.url.includes(${JSON.stringify(`id=${page_id}`)}) && tab.url.includes("#")).sort((a, b) => a.index - b.index).map((tab) => tab.url.slice(tab.url.indexOf("#"))).join(","))()`);
  const here_hash = () => in_active_tab("location.hash");

  await run_case("Enter opens the first selected item here and the rest in background tabs, and ends the selection", async () => {
    await start("iv_open_range_list");
    await press_keys("jj");
    await expect_range(3);
    await press_keys("-k", "Return");
    await poll_until("the first item opened here", async () => (await here_hash()) === "#c0");
    await poll_until("the rest in background tabs", async () => (await background_hashes("iv_open_range_list")).split(",").sort().join(",") === "#c0,#c1,#c2");
    await expect_badge("ITEM");
  });

  await run_case("Ctrl+Enter opens every selected item in background tabs and ends the selection", async () => {
    await start("iv_open_bg_list");
    await press_keys("j");
    await expect_range(2);
    await press_keys("-M", "ctrl", "-k", "Return", "-m", "ctrl");
    await poll_until("both items in background tabs", async () => (await background_hashes("iv_open_bg_list")).split(",").sort().join(",") === "#c0,#c1");
    expect((await here_hash()) === "", "the current tab moved");
    await expect_badge("ITEM");
  });

  // Last, since it rebinds f for the rest of the piece. The page reads the keymap again after the reload, and the background resolves the new item key into visual item mode.
  await run_case("after a config reload rebinds f in item mode, f in visual item mode ends the selection and runs the new binding", async () => {
    const dir = row_config();
    appendFileSync(join(dir, "keymap.toml"), ["", "[item]", 'f = "page.item --direction=down"', ""].join("\n"));
    // The reload key is a normal mode key, and the case before ends in item mode.
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await load_config_dir(dir);
    await start("iv_reload_f_dyn");
    await press_keys("j");
    await expect_range(2);
    await press_keys("f");
    await expect_badge("ITEM");
    await expect_focus("c2");
    expect((await hint_label_count()) === 0, "f still shows hints");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
  });
}
