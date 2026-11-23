// Item mode, entered with I and left with Escape: the badge, the walk through a list, the same current item on the way back in, and the setting file left alone. The tab holds the mode: a frame that is open, one that loads later and one that reloads take it, Escape in any frame ends it for all, a reload of the page ends it, a pushState keeps it, a field that takes the focus ends it, the command line opens and closes inside it, and the hint keys, gi and ]t, which it takes from normal mode, work in it. f follows a config reload that rebinds f in normal mode.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "tabs", "bundles"];

export async function run_cases({ events, wait_event, run_line, config_dir, config_copy, load_config_dir, setup, open_cmdline, close_cmdline, run_case, open_page, press_keys, in_active_tab, in_background, wait_active_tab, hint_label_count, poll_until, expect, sleep }) {
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const expect_badge = (label) => poll_until(`the ${label} badge`, async () => (await badge()) === label);
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const frame_focused = () => in_active_tab(`document.getElementById("inner").contentDocument.activeElement?.id ?? ""`);
  const expect_frame_focus = (wanted) => poll_until(`focus on ${wanted} in the frame`, async () => (await frame_focused()) === wanted);
  const focus_frame = () => in_active_tab(`document.getElementById("inner").contentWindow.focus(); 0`);
  const open_list = (id) => open_page("item_list", id, { new_tab: true });
  const scrolled = async () => (await in_active_tab("scrollY")) > 0;

  let active_config = config_dir;
  await setup("bind a bare picker on I for the im_nolanding_ pages, so the leaf has no step after the pick", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=im_nolanding_*"', 'bind = { I = "hint --lists" }', ""].join("\n"));
    await load_config_dir(dir);
    active_config = dir;
  });

  await run_case("I enters item mode, j walks the cards and Escape leaves, after which j scrolls again", async () => {
    await open_list("im_basic");
    await expect_badge("NORMAL");
    await press_keys("I");
    await expect_badge("ITEM");
    // The pick starts the walk and lands on the current item, the first one in view.
    await expect_focus("c0");
    await press_keys("j");
    await expect_focus("c1");
    await press_keys("3j");
    await expect_focus("c4");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await press_keys("j");
    await poll_until("the page to scroll", scrolled);
    expect((await focused()) === "", "j moved the focus in normal mode");
  });

  await run_case("entering item mode writes no setting", async () => {
    await open_list("im_no_write");
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    expect(!readFileSync(join(active_config, "settings.toml"), "utf8").includes("item_navigator"), "I wrote item_navigator to settings.toml");
  });

  await run_case("I after Escape goes on from the same current item, and zz inside the mode lands on it again", async () => {
    await open_list("im_same");
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c1");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await press_keys("I");
    await expect_badge("ITEM");
    await expect_focus("c1");
    await press_keys("j");
    await expect_focus("c2");
    await in_active_tab("document.activeElement.blur(); 0");
    await press_keys("zz");
    await expect_focus("c2");
    await in_active_tab("document.activeElement.blur(); 0");
    await press_keys("I");
    await expect_focus("c2");
  });

  await run_case("a key that item mode does not bind goes to the page", async () => {
    await open_list("im_pass");
    await run_line("mode item");
    await expect_badge("ITEM");
    await in_active_tab(`window.__keys = []; addEventListener("keydown", (event) => window.__keys.push(event.key)); 0`);
    await press_keys("x");
    await poll_until("the page to see x", async () => (await in_active_tab("window.__keys")).includes("x"));
    await expect_badge("ITEM");
  });

  await run_case("]t, a key item mode takes from normal mode, goes to the next tab, and the list tab stays in item mode", async () => {
    await open_list("im_next_tab");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("]t");
    await wait_active_tab((page_id) => page_id !== "im_next_tab", "another tab to be active");
    const mode_there = await in_background(`(async () => { const [tab] = (await browser.tabs.query({})).filter((tab) => tab.url.includes("id=im_next_tab")); return (await browser.tabs.executeScript(tab.id, { code: 'document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null' }))[0]; })()`);
    expect(mode_there === "ITEM", `the list tab is in ${mode_there}, not item mode`);
  });

  await run_case("i in item mode reaches insert mode and V reaches visual item mode", async () => {
    await open_list("im_keys_modes");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("i");
    await expect_badge("INSERT");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("V");
    await expect_badge("VISUAL 1");
    // Visual item mode selects an item range and no page text.
    expect((await in_active_tab("getSelection().rangeCount")) === 0, "V selected page text");
  });

  await run_case("f labels the page and Escape returns to item mode, and gi focuses the field and leaves the mode", async () => {
    await open_list("im_keys_field");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("f");
    await poll_until("hint mode", async () => (await badge()) !== "ITEM");
    await press_keys("-k", "Escape");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
    await press_keys("gi");
    await expect_focus("q");
    await expect_badge("INSERT");
  });

  await run_case("the command line opens and closes inside item mode", async () => {
    await open_list("im_cmdline");
    await run_line("mode item");
    await expect_badge("ITEM");
    await open_cmdline();
    await poll_until("the mode to leave item", async () => (await badge()) !== "ITEM");
    await close_cmdline();
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
  });

  await run_case("a frame of the page is in item mode with the tab, and Escape in the frame ends it for the top page too", async () => {
    await open_list("im_frame_join_frame");
    await poll_until("the frame to load", async () => (await in_active_tab(`document.getElementById("inner").contentDocument.readyState`)) === "complete");
    await run_line("mode item");
    await expect_badge("ITEM");
    await focus_frame();
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_frame_focus("f0");
    await press_keys("-k", "Escape");
    await expect_badge("FRAME");
    await in_active_tab(`window.focus(); document.activeElement?.blur(); window.scrollTo(0, 0); 0`);
    await press_keys("j");
    await poll_until("the top page to scroll", scrolled);
    expect((await focused()) === "", "the top page stayed in item mode after the frame left it");
  });

  await run_case("a frame that loads while the mode is held joins it", async () => {
    await open_list("im_late_frame");
    await run_line("mode item");
    await expect_badge("ITEM");
    await in_active_tab(`(() => { const frame = document.createElement("iframe"); frame.id = "inner"; frame.src = "/item_frame?id=im_late_frame_inner"; frame.style.cssText = "display:block;width:560px;height:300px"; document.body.prepend(frame); return 0; })()`);
    await poll_until("the frame to load", async () => (await in_active_tab(`document.getElementById("inner").contentDocument?.readyState`)) === "complete");
    await focus_frame();
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_frame_focus("f0");
  });

  // The frame takes I itself, so it is in the hold when it reloads.
  await run_case("a frame that reloads while the mode is held joins again and the tab keeps the mode", async () => {
    await open_list("im_reload_frame_frame");
    await poll_until("the frame to load", async () => (await in_active_tab(`document.getElementById("inner").contentDocument?.readyState`)) === "complete");
    await focus_frame();
    await expect_badge("FRAME");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_frame_focus("f0");
    await in_active_tab(`(() => { const inner = document.getElementById("inner").contentWindow; inner.old_document = true; inner.location.reload(); return 0; })()`);
    await poll_until("the frame to load again", async () => (await in_active_tab(`(() => { const inner = document.getElementById("inner").contentWindow; return !inner.old_document && inner.document.readyState; })()`)) === "complete");
    await focus_frame();
    await sleep(500);
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_frame_focus("f0");
    await in_active_tab(`window.focus(); document.activeElement?.blur(); 0`);
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
  });

  // A link the page follows itself keeps item mode on the new page (p49_item_start), so a reload stands for the load here.
  await run_case("a reload of the page ends item mode, and a pushState keeps it", async () => {
    await open_list("im_nav");
    await run_line("mode item");
    await expect_badge("ITEM");
    await in_active_tab(`history.pushState({}, "", location.pathname + "?id=im_nav_pushed"); 0`);
    await sleep(500);
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
    // The page reads its id from the address, which the pushState changed. The tab refuses scripts while it reloads, so the poll starts once the new document has read its keys.
    const reload_mark = events.length;
    await in_active_tab(`location.reload(); 0`);
    await wait_event(reload_mark, (event) => event.type === "tree_read" && event.page_id === "im_nav_pushed", "content script ready after the reload", 6000);
    await poll_until("the reload to complete", async () => (await in_active_tab("document.readyState")) === "complete");
    await expect_badge("NORMAL");
    await sleep(500);
    await press_keys("j");
    await poll_until("the new page to scroll", scrolled);
    expect((await focused()) === "", "the new page took j as an item key");
  });

  await run_case("a field that takes the focus ends item mode, and leaving the field does not bring it back", async () => {
    await open_list("im_field_field");
    await run_line("mode item");
    await expect_badge("ITEM");
    await in_active_tab("document.getElementById('q').focus(); 0");
    await expect_badge("INSERT");
    await in_active_tab("document.getElementById('q').blur(); 0");
    await expect_badge("NORMAL");
    await press_keys("j");
    await poll_until("the page to scroll", scrolled);
    expect((await focused()) === "", "j walked the cards after the field left item mode");
  });

  await run_case("I on a page with no list stays in normal mode", async () => {
    await open_page("controls", "im_no_list", { new_tab: true });
    await press_keys("I");
    const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
    await poll_until("the notice", async () => (await toast_text()).includes("No list on this page"));
    await expect_badge("NORMAL");
  });

  await run_case("I then j typed together lands one item down, and the key typed behind the pick waits for the landing", async () => {
    await open_list("im_fast");
    await press_keys("I", "j");
    await expect_badge("ITEM");
    await expect_focus("c1");
    await sleep(500);
    expect((await focused()) === "c1", "the key typed after I landed on " + (await focused()));
  });

  // The leaf ends with the pick and no landing follows, so the key typed behind it must not wait for one.
  await run_case("I with no landing step after the pick still passes the key typed behind it", async () => {
    await open_list("im_nolanding_a");
    await press_keys("I", "j");
    await expect_badge("ITEM");
    await poll_until("j to focus a card", async () => (await focused()).startsWith("c"));
    const first = await focused();
    await press_keys("j");
    await poll_until("the next j to move on", async () => (await focused()) !== first && (await focused()).startsWith("c"));
  });

  const hint_labels = () => in_active_tab(`[...document.documentElement.children].reduce((sum, child) => sum + (child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint").length ?? 0), 0)`);

  // The label texts with the top edge of each, in the order of the page.
  const hint_tops = () => in_active_tab(`JSON.stringify([...document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])].map((node) => [node.textContent, node.getBoundingClientRect().top])))`).then((text) => JSON.parse(text));

  await run_case("f in item mode labels the page too, with the item's targets on the first labels, and after Escape f labels in page order", async () => {
    await open_list("im_scope");
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("jj");
    await expect_focus("c2");
    const link_top = Number(await in_active_tab(`document.getElementById("c2").getBoundingClientRect().top`));
    await press_keys("f");
    await poll_until("the labels", async () => (await hint_labels()) > 1);
    const ranked = await hint_tops();
    expect(ranked[0] !== undefined && ranked[0][0].length === 1 && Math.abs(ranked[0][1] - link_top) < 40, `the item's label comes first and is the shortest: ${JSON.stringify(ranked)} against ${link_top}`);
    await press_keys("-k", "Escape");
    await expect_badge("ITEM");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await press_keys("f");
    await poll_until("the page labels", async () => (await hint_labels()) > 1);
    const in_order = await hint_tops();
    expect(in_order[0] !== undefined && Math.abs(in_order[0][1] - link_top) > 40, "in normal mode the first label stays on the first link");
    await press_keys("-k", "Escape");
  });

  await run_case("f in item mode with no item moved to yet labels the page", async () => {
    await open_list("im_scope_none");
    await run_line("mode item");
    await expect_badge("ITEM");
    await press_keys("f");
    await poll_until("the page labels", async () => (await hint_labels()) > 1);
    await press_keys("-k", "Escape");
  });

  await run_case("H in item mode goes back in the tab history", async () => {
    await open_list("im_hist_a");
    // The tab refuses scripts while it navigates, so each poll starts once the new document has read its keys.
    const forward_mark = events.length;
    await in_active_tab(`location.href = "/item_list?id=im_hist_b"; 0`);
    await wait_event(forward_mark, (event) => event.type === "tree_read" && event.page_id === "im_hist_b", "content script ready on the second page", 6000);
    await poll_until("the second page", async () => (await in_active_tab("location.search")) === "?id=im_hist_b" && (await in_active_tab("document.readyState")) === "complete");
    await sleep(800);
    await press_keys("I");
    await expect_badge("ITEM");
    const back_mark = events.length;
    await press_keys("H");
    await wait_event(back_mark, (event) => event.type === "tree_read" && event.page_id === "im_hist_a", "content script ready on the first page again", 6000);
    await poll_until("the first page again", async () => (await in_active_tab("location.search")) === "?id=im_hist_a" && (await in_active_tab("document.readyState")) === "complete");
  });

  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
  const expect_toast = (text) => poll_until(`the notice ${text}`, async () => (await toast_text()).includes(text));

  // Three sections of two cards: c0 c1, c2 c3, c4 c5.
  await run_case("} and { jump between the sections the finder nests, { first goes to the start of its own section, and a count jumps that many", async () => {
    await open_list("im_sections");
    await press_keys("I");
    await expect_badge("ITEM");
    await expect_focus("c0");
    await press_keys("}");
    await expect_focus("c2");
    await press_keys("j", "{");
    await expect_focus("c2");
    await press_keys("{");
    await expect_focus("c0");
    await press_keys("2}");
    await expect_focus("c4");
    await press_keys("}");
    await expect_toast("No next section");
    await press_keys("9{");
    await expect_focus("c0");
    await press_keys("{");
    await expect_toast("No previous section");
  });

  await run_case("} and { on a flat list say there are no sections and leave the page where it is", async () => {
    await open_list("im_flat");
    await press_keys("I");
    await expect_badge("ITEM");
    await expect_focus("c0");
    await press_keys("}");
    await expect_toast("No sections in this list");
    await press_keys("{");
    await expect_focus("c0");
    expect(!(await scrolled()), "} scrolled a list with no sections");
  });

  await run_case("zz in item mode goes back to the current item and centers it", async () => {
    await open_list("im_align");
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("6j");
    await expect_focus("c6");
    await in_active_tab("window.scrollTo(0, 0); document.activeElement.blur(); 0");
    await press_keys("zz");
    await expect_focus("c6");
    await poll_until("the item centered", async () => (await in_active_tab(`(() => { const box = document.activeElement.getBoundingClientRect(); return Math.abs((box.top + box.bottom) / 2 - innerHeight / 2) < 80; })()`)) === true);
  });

  // Last, since it rebinds f for the rest of the piece. Item mode takes f from normal mode, so the page's next keymap read brings the new binding.
  await run_case("after a config reload rebinds f in normal mode, f in item mode runs the new binding", async () => {
    const dir = config_copy();
    // A file of its own, since keymap.toml already has a [normal] table.
    writeFileSync(join(dir, "keymap.d", "90-item-reload.toml"), ["[normal]", 'f = "page.item --direction=down"', ""].join("\n"));
    // The reload key is a normal mode key, and the case before ends in item mode.
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await load_config_dir(dir);
    await open_list("im_reload_f");
    await press_keys("I");
    await expect_badge("ITEM");
    await expect_focus("c0");
    await press_keys("f");
    await expect_focus("c1");
    expect((await hint_label_count()) === 0, "f still shows hints");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
  });
}
