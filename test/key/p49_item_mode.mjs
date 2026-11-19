// Item mode, entered with I and left with Escape: the badge, the walk through a list, the same current item on the way back in, and the setting file left alone. The tab holds the mode: a frame that is open, one that loads later and one that reloads take it, Escape in any frame ends it for all, a load of the page ends it, a pushState keeps it, a field that takes the focus ends it, the command line opens and closes inside it, and the copied hint keys and gi work in it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "tabs", "bundles"];

export async function run_cases({ config_dir, open_cmdline, close_cmdline, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const expect_badge = (label) => poll_until(`the ${label} badge`, async () => (await badge()) === label);
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const frame_focused = () => in_active_tab(`document.getElementById("inner").contentDocument.activeElement?.id ?? ""`);
  const expect_frame_focus = (wanted) => poll_until(`focus on ${wanted} in the frame`, async () => (await frame_focused()) === wanted);
  const focus_frame = () => in_active_tab(`document.getElementById("inner").contentWindow.focus(); 0`);
  const open_list = (id) => open_page("item_list", id, { new_tab: true });
  const scrolled = async () => (await in_active_tab("scrollY")) > 0;

  await run_case("I enters item mode, j walks the cards and Escape leaves, after which j scrolls again", async () => {
    await open_list("im_basic");
    await expect_badge("NORMAL");
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
    await press_keys("3j");
    await expect_focus("c3");
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
    expect(!readFileSync(join(config_dir, "settings.toml"), "utf8").includes("item_navigator"), "I wrote item_navigator to settings.toml");
  });

  await run_case("I after Escape goes on from the same current item, and I inside the mode lands on it again", async () => {
    await open_list("im_same");
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("jj");
    await expect_focus("c1");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await press_keys("I");
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c2");
    await in_active_tab("document.activeElement.blur(); 0");
    await press_keys("I");
    await expect_focus("c2");
  });

  await run_case("a key that item mode does not bind goes to the page", async () => {
    await open_list("im_pass");
    await press_keys("I");
    await expect_badge("ITEM");
    await in_active_tab(`window.__keys = []; addEventListener("keydown", (event) => window.__keys.push(event.key)); 0`);
    await press_keys("x");
    await poll_until("the page to see x", async () => (await in_active_tab("window.__keys")).includes("x"));
    await expect_badge("ITEM");
  });

  await run_case("f labels the page and Escape returns to item mode, and gi focuses the field and leaves the mode", async () => {
    await open_list("im_keys_field");
    await press_keys("I");
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
    await press_keys("I");
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
    await press_keys("I");
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
    await press_keys("I");
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
    await press_keys("I");
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

  await run_case("a load of the page ends item mode, and a pushState keeps it", async () => {
    await open_list("im_nav");
    await press_keys("I");
    await expect_badge("ITEM");
    await in_active_tab(`history.pushState({}, "", location.pathname + "?id=im_nav_pushed"); 0`);
    await sleep(500);
    await expect_badge("ITEM");
    await press_keys("j");
    await expect_focus("c0");
    await in_active_tab(`location.href = "/item_list?id=im_nav_loaded"; 0`);
    await poll_until("the new page to load", async () => (await in_active_tab("location.search")) === "?id=im_nav_loaded" && (await in_active_tab("document.readyState")) === "complete");
    await expect_badge("NORMAL");
    await sleep(500);
    await press_keys("j");
    await poll_until("the new page to scroll", scrolled);
    expect((await focused()) === "", "the new page took j as an item key");
  });

  await run_case("a field that takes the focus ends item mode, and leaving the field does not bring it back", async () => {
    await open_list("im_field_field");
    await press_keys("I");
    await expect_badge("ITEM");
    await in_active_tab("document.getElementById('q').focus(); 0");
    await expect_badge("INSERT");
    await in_active_tab("document.getElementById('q').blur(); 0");
    await expect_badge("NORMAL");
    await press_keys("j");
    await poll_until("the page to scroll", scrolled);
    expect((await focused()) === "", "j walked the cards after the field left item mode");
  });
}
