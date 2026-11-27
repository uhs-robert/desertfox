// blur_on_load on a tab switch: a site row takes the focus away from a field that holds it, or that the page focuses, as its tab is shown again, until a key, a click or about 1 s after the show.
// Each case checks that the keys still work after the blur, since a blur that left the keys dead would pass a focus check alone.
// The row lives in a config copy, so no other piece sees it. The held Shift+J cases come first, while the window holds only their tabs.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["keys", "config", "tabs"];

const BLUR_WINDOW_MS = 1000;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, send_keys, in_background, in_active_tab, wait_event, wait_active_tab, tab_switch_mark, tabs_shown_since, poll_until, settle_focus, events, url_of, scroll_of, expect, sleep, rdp, close_tabs_with, escape_to_normal }) {
  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  const tab_id_of = async (page_id) => {
    const tab_id = await in_background(`browser.tabs.query({}).then((tabs) => tabs.find((tab) => URL.canParse(tab.url) && new URL(tab.url).searchParams.get("id") === ${JSON.stringify(page_id)})?.id)`);
    if (tab_id === undefined) throw new Error(`no tab shows ${page_id}: ${JSON.stringify(await in_background("browser.tabs.query({}).then((tabs) => tabs.map((tab) => tab.url))"))}`);
    return tab_id;
  };
  const in_tab = async (page_id, code) => in_background(`browser.tabs.executeScript(${await tab_id_of(page_id)}, { code: ${JSON.stringify(code)} }).then((answers) => answers[0])`);
  const show_tab = async (page_id) => {
    await in_background(`browser.tabs.update(${await tab_id_of(page_id)}, { active: true }).then(() => true)`);
    await wait_active_tab(page_id, `tab ${page_id} after the background showed it`);
  };
  const focused_id = () => in_active_tab(`document.activeElement?.id ?? ""`);
  // A trace of focus and visibility in the active page, for the failure text.
  const trace_focus = () => in_active_tab(`(() => { const log = (window.p24_log = []); const at = () => document.activeElement?.id || document.activeElement?.localName; for (const type of ["focusin", "focusout", "focus", "blur", "keydown", "mousedown"]) addEventListener(type, (event) => log.push(type + ":" + (event.target.id || event.target.localName || "win") + (event.repeat ? ":rep" : "")), true); document.addEventListener("visibilitychange", () => log.push("vis:" + document.visibilityState + ":" + at()), true); return true; })()`);
  const page_state = async (page_id) => `badge ${badge_of(page_id)}, focus on "${await focused_id()}", trace ${await in_active_tab("JSON.stringify(window.p24_log ?? [])")}, events ${JSON.stringify(events.filter((event) => event.page_id === page_id).slice(-12).map((event) => [event.type, event.label ?? event.key ?? event.id ?? event.state ?? ""]))}`;
  const with_state = (page_id, wait) => wait.catch(async (error) => { throw new Error(`${error.message}: ${await page_state(page_id)}`); });
  // A focus the page gives before its window has the focus fires no focus event, so the page's own report after its show focus counts too.
  const focused_since = (mark, page_id, field_id = "field") => (event) => events.indexOf(event) >= mark && (event.type === "focused" || event.type === "show_focused") && event.page_id === page_id && event.id === field_id;

  const expect_blurred = async (page_id, field_id = "field") => {
    await with_state(page_id, poll_until(`NORMAL on ${page_id}`, async () => badge_of(page_id) === "NORMAL" && (await focused_id()) !== field_id, { timeout_ms: 3000 }));
  };
  // j scrolls the page and types nothing. A key of the first moments after a switch can be lost, so j repeats a few times, which a field holding the focus fails every time.
  const expect_keys_work = async (page_id, scroll_page_ids = [page_id]) => {
    for (let attempt = 0; ; attempt++) {
      const mark = events.length;
      await press_keys("j");
      if (await wait_event(mark, (event) => event.type === "scroll" && scroll_page_ids.includes(event.page_id), "a scroll from j", 700).then(() => true, () => false)) break;
      if (attempt >= 2) throw new Error(`j never scrolled ${scroll_page_ids.join(" or ")}: ${await page_state(page_id)}`);
    }
    const typed = await in_active_tab(`[...document.querySelectorAll("input:not([type=checkbox])")].map((field) => field.value).join("")`);
    expect(typed === "", `a field on ${page_id} took typed text "${typed}"`);
  };
  const switch_by_key = async (key, page_id) => {
    await press_keys(key);
    await wait_active_tab(page_id, `tab ${page_id} after ${key}`);
  };
  const tab_order = () => in_background(`browser.tabs.query({ currentWindow: true }).then((tabs) => tabs.map((tab) => new URL(tab.url).searchParams.get("id")))`);
  // Every tab of the row in turn by J: a field tab comes back in normal mode, and j scrolls each.
  const expect_keys_in_every_tab = async (field_ids) => {
    const order = await tab_order();
    const start = order.indexOf(await in_active_tab(`new URLSearchParams(location.search).get("id")`));
    for (let step = 1; step <= order.length; step++) {
      const page_id = order[(start + step) % order.length];
      await switch_by_key("J", page_id);
      if (field_ids.includes(page_id)) await expect_blurred(page_id);
      await expect_keys_work(page_id);
    }
  };
  // Holds Shift+J for 1.5 s and checks that each repeat went on to the next tab, with no stop at a field.
  const hold_shift_j = async () => {
    const order = await tab_order();
    const switch_mark = await tab_switch_mark();
    await send_keys("-M", "shift", "-P", "j", "-s", "1500", "-p", "j", "-m", "shift");
    await sleep(500);
    const shown = await tabs_shown_since(switch_mark);
    expect(shown.length >= order.length + 1, `holding Shift+J switched ${shown.length} times over ${order.length} tabs: ${shown.join(", ")}`);
    const skipped = shown.findIndex((id, index) => index > 0 && id !== order[(order.indexOf(shown[index - 1]) + 1) % order.length]);
    expect(skipped < 0, `a repeat did not land on the next tab: ${shown.join(", ")}`);
    const typed = await in_background(`(async () => { let text = ""; for (const tab of await browser.tabs.query({ currentWindow: true })) text += (await browser.tabs.executeScript(tab.id, { code: '[...document.querySelectorAll("input:not([type=checkbox])")].map((field) => field.value).join("")' }).catch(() => [""]))[0]; return text; })()`);
    expect(typed === "", `a held Shift+J typed "${typed}" into a field`);
    await settle_focus();
  };

  await setup("load a config with a blur_on_load row for the blur_ pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=blur_*"\nblur_on_load = true\n');
    await load_config_dir(dir);
  });

  await run_case("holding Shift+J over tabs whose page focuses its field on each show keeps switching, and keys work in every tab after", async () => {
    await open_page("page", "blur_h_a", { new_tab: true });
    await open_page("switch_field", "blur_h_b", { new_tab: true });
    await open_page("switch_field", "blur_h_c_delay", { new_tab: true });
    await open_page("page", "blur_h_d", { new_tab: true });
    await hold_shift_j();
    await expect_keys_in_every_tab(["blur_h_b", "blur_h_c_delay"]);
    await close_tabs_with("blur_h_");
    await settle_focus();
  });

  await run_case("holding Shift+J over discarded tabs that load on the switch and focus their field keeps switching, and keys work in every tab after", async () => {
    await open_page("page", "blur_d_a", { new_tab: true });
    await open_page("switch_field", "blur_d_b", { new_tab: true });
    await open_page("switch_field", "blur_d_c", { new_tab: true });
    await open_page("page", "blur_d_d", { new_tab: true });
    await show_tab("blur_d_a");
    await settle_focus();
    for (const page_id of ["blur_d_b", "blur_d_c", "blur_d_d"]) await in_background(`browser.tabs.discard(${await tab_id_of(page_id)})`);
    await poll_until("the three tabs to be discarded", () => in_background(`browser.tabs.query({ discarded: true }).then((tabs) => tabs.length === 3)`));
    await hold_shift_j();
    await expect_keys_in_every_tab(["blur_d_b", "blur_d_c"]);
    await close_tabs_with("blur_d_");
    await settle_focus();
  });

  await run_case("a single J onto a discarded tab that loads and focuses its field blurs it once, and keys work", async () => {
    await open_page("page", "blur_d1_a", { new_tab: true });
    await open_page("switch_field", "blur_d1_b", { new_tab: true });
    await show_tab("blur_d1_a");
    await settle_focus();
    await in_background(`browser.tabs.discard(${await tab_id_of("blur_d1_b")})`);
    await poll_until("the tab to be discarded", () => in_background(`browser.tabs.query({ discarded: true }).then((tabs) => tabs.length === 1)`));
    const mark = events.length;
    await switch_by_key("J", "blur_d1_b");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "blur_d1_b", "content script ready on blur_d1_b", 6000);
    await with_state("blur_d1_b", wait_event(mark, focused_since(mark, "blur_d1_b"), "the page to focus its field", 3000));
    await expect_blurred("blur_d1_b");
    await expect_keys_work("blur_d1_b");
    await switch_by_key("K", "blur_d1_a");
    await expect_keys_work("blur_d1_a");
    await close_tabs_with("blur_d1_");
    await settle_focus();
  });

  for (const [what, id, wait_ms] of [
    ["after DesertFox's show listener", "blur_sw", 0],
    ["before DesertFox's show listener", "blur_sw_early", 0],
    ["300 ms after the show", "blur_sw_delay", 400],
  ]) {
    await run_case(`a field the page focuses ${what} loses the focus when its tab is shown again, and keys work`, async () => {
      await open_page("switch_field", id, { new_tab: true });
      await open_page("page", `${id}_next`, { new_tab: true });
      const mark = events.length;
      await switch_by_key("K", id);
      await with_state(id, wait_event(mark, focused_since(mark, id), "the page to focus its field on the show", 3000));
      await sleep(wait_ms);
      await expect_blurred(id);
      await expect_keys_work(id);
      await switch_by_key("J", `${id}_next`);
      await expect_keys_work(`${id}_next`);
    });
  }

  await run_case("a field the page focuses 1.5 s after the show, past the window, keeps the focus", async () => {
    await open_page("switch_field", "blur_sw_late", { new_tab: true });
    await open_page("page", "blur_sw_late_next", { new_tab: true });
    const mark = events.length;
    await switch_by_key("K", "blur_sw_late");
    await with_state("blur_sw_late", wait_event(mark, focused_since(mark, "blur_sw_late"), "the late page focus", 4000));
    await with_state("blur_sw_late", poll_until("INSERT after the late focus", async () => badge_of("blur_sw_late") === "INSERT" && (await focused_id()) === "field"));
    await escape_to_normal("blur_sw_late");
  });

  await run_case("a page with no row keeps the field it focuses on a show", async () => {
    await open_page("switch_field", "plain_sw", { new_tab: true });
    await open_page("page", "plain_sw_next", { new_tab: true });
    const mark = events.length;
    await switch_by_key("K", "plain_sw");
    await wait_event(mark, focused_since(mark, "plain_sw"), "the page to focus its field on the show", 3000);
    await sleep(300);
    await with_state("plain_sw", poll_until("INSERT on the page with no row", async () => badge_of("plain_sw") === "INSERT" && (await focused_id()) === "field"));
    await escape_to_normal("plain_sw");
  });

  await run_case("a field the user left focused loses the focus when its tab is shown again", async () => {
    await open_page("controls", "blur_left", { new_tab: true });
    await open_page("page", "blur_left_next", { new_tab: true });
    await switch_by_key("K", "blur_left");
    await settle_focus();
    await trace_focus();
    expect((await in_active_tab(`document.getElementById("first").focus(); document.activeElement.id`)) === "first", "the field took no focus");
    await poll_until("INSERT in the field", async () => badge_of("blur_left") === "INSERT");
    // J would type into the field, so the background switches away.
    const hide_mark = events.length;
    await show_tab("blur_left_next");
    await settle_focus();
    await with_state("blur_left", wait_event(hide_mark, (event) => event.type === "visibility" && event.page_id === "blur_left" && event.state === "hidden", `blur_left to report that it is hidden (now ${await in_tab("blur_left", "document.visibilityState")})`, 3000));
    await switch_by_key("K", "blur_left");
    await expect_blurred("blur_left", "first");
    await expect_keys_work("blur_left");
  });

  await run_case("a field that holds the focus as the page turns visible, with no focus event, loses it", async () => {
    await open_page("controls", "blur_still", { new_tab: true });
    expect((await in_active_tab(`document.getElementById("first").focus(); document.activeElement.id`)) === "first", "the field took no focus");
    await poll_until("INSERT in the field", async () => badge_of("blur_still") === "INSERT");
    // The tab stays selected and the browser keeps the focus: only the document's visibility changes, so no focus event fires.
    await trace_focus();
    const mark = events.length;
    const toggled = await evaluate_in_chrome(rdp, `(async () => {
      const browser = Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser;
      const seen = [browser.browsingContext.isActive];
      browser.browsingContext.isActive = false;
      seen.push(browser.browsingContext.isActive);
      await new Promise((resolve) => Services.wm.getMostRecentWindow("navigator:browser").setTimeout(resolve, 300));
      browser.browsingContext.isActive = true;
      seen.push(browser.browsingContext.isActive);
      return seen;
    })()`).catch((error) => `error ${error.message}`);
    await with_state("blur_still", wait_event(mark, (event) => event.type === "visibility" && event.page_id === "blur_still" && event.state === "visible", `the page to turn visible (isActive ${JSON.stringify(toggled)})`, 3000));
    expect(!events.slice(mark).some((event) => event.page_id === "blur_still" && event.type === "focused"), "a focus event fired, so this case tests the wrong path");
    await expect_blurred("blur_still", "first");
    await expect_keys_work("blur_still");
  });

  // A real mouse press through the widget, so the page gets trusted events and user activation, as from a mouse.
  const click_on = async (id, page_id) => {
    const [x, y] = await in_active_tab(`(() => { const box = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return [box.left + 10, box.top + box.height / 2]; })()`);
    for (let attempt = 0; attempt < 8; attempt++) {
      await evaluate_in_chrome(rdp, `(async () => {
        const win = Services.wm.getMostRecentWindow("navigator:browser");
        const browser = win.gBrowser.selectedBrowser;
        const box = browser.getBoundingClientRect();
        const at = [(win.mozInnerScreenX + box.left + ${x}) * win.devicePixelRatio, (win.mozInnerScreenY + box.top + ${y}) * win.devicePixelRatio];
        for (const message of [win.windowUtils.NATIVE_MOUSE_MESSAGE_MOVE, win.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_DOWN, win.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_UP]) {
          win.windowUtils.sendNativeMouseEvent(at[0], at[1], message, 0, 0, browser, null);
          await new Promise((resolve) => win.setTimeout(resolve, 20));
        }
      })()`);
      if ((await focused_id()) === id) return;
      await sleep(40);
    }
    throw new Error(`no press reached the field: ${await page_state(page_id)}`);
  };

  await run_case("a click into the field right after the switch keeps the focus there", async () => {
    await open_page("switch_field", "blur_click", { new_tab: true });
    await open_page("page", "blur_click_next", { new_tab: true });
    await switch_by_key("K", "blur_click");
    const shown_at = Date.now();
    await click_on("field", "blur_click");
    expect(Date.now() - shown_at < BLUR_WINDOW_MS - 100, `the click came ${Date.now() - shown_at} ms after the switch, too late to test the window`);
    await sleep(BLUR_WINDOW_MS);
    await with_state("blur_click", poll_until("INSERT after the click", async () => badge_of("blur_click") === "INSERT" && (await focused_id()) === "field"));
    await escape_to_normal("blur_click");
  });

  await run_case("a key the page answers with a focus right after the switch keeps the focus there", async () => {
    await open_page("switch_field", "blur_key", { new_tab: true });
    await open_page("page", "blur_key_next", { new_tab: true });
    await switch_by_key("K", "blur_key");
    const shown_at = Date.now();
    await expect_blurred("blur_key");
    const mark = events.length;
    // F2 is bound to nothing, so the page gets it and focuses its field. A key of the first moments can be lost, so it repeats until the page saw one.
    for (let attempt = 0; !events.slice(mark).some((event) => event.type === "keydown" && event.page_id === "blur_key" && event.key === "F2"); attempt++) {
      if (attempt >= 5) throw new Error(`the page never saw F2: ${await page_state("blur_key")}`);
      await press_keys("-k", "F2");
      await sleep(100);
    }
    expect(Date.now() - shown_at < BLUR_WINDOW_MS, `F2 came ${Date.now() - shown_at} ms after the switch, too late to test the window`);
    await sleep(BLUR_WINDOW_MS);
    await with_state("blur_key", poll_until("INSERT after F2", async () => badge_of("blur_key") === "INSERT" && (await focused_id()) === "field"));
    await escape_to_normal("blur_key");
  });

  await run_case("a tab hidden again before its window ends keeps a focus it got while hidden, and loses it at the next show", async () => {
    await open_page("switch_field", "blur_hide_delay", { new_tab: true });
    await open_page("page", "blur_hide_next", { new_tab: true });
    const mark = events.length;
    await show_tab("blur_hide_delay");
    await wait_event(mark, (event) => event.type === "visibility" && event.page_id === "blur_hide_delay" && event.state === "visible", "the page to turn visible", 3000);
    await show_tab("blur_hide_next");
    await with_state("blur_hide_delay", wait_event(mark, focused_since(mark, "blur_hide_delay"), "the delayed page focus while hidden", 3000));
    await sleep(200);
    // The hide ended the window, so the focus the page gave while hidden stays until the tab is shown again.
    expect((await in_tab("blur_hide_delay", `document.activeElement?.id ?? ""`)) === "field", "the field lost a focus the page gave while hidden");
    await settle_focus();
    await switch_by_key("K", "blur_hide_delay");
    await expect_blurred("blur_hide_delay");
    await expect_keys_work("blur_hide_delay");
  });

  await run_case("a field a child frame focuses when the tab is shown again loses the focus there", async () => {
    const inner_id = "blur_sw_inner";
    // The frame holds the focus after its load focus, so it reports the key probe.
    await open_page("switch_field", "blur_sw_outer", { new_tab: true, keys_page_id: inner_id });
    await open_page("page", "blur_sw_outer_next", { new_tab: true });
    const mark = events.length;
    await switch_by_key("K", "blur_sw_outer");
    await with_state(inner_id, wait_event(mark, focused_since(mark, inner_id), "the frame to focus its field on the show", 3000));
    const inner_focus = `document.getElementById("inner").contentDocument.activeElement?.id ?? ""`;
    await with_state(inner_id, poll_until("the frame's field to lose the focus", async () => (await in_active_tab(inner_focus)) !== "field", { timeout_ms: 3000 }));
    await expect_keys_work("blur_sw_outer", ["blur_sw_outer", inner_id]);
    const typed = await in_active_tab(`document.getElementById("inner").contentDocument.getElementById("field").value`);
    expect(typed === "", `the frame's field took typed text "${typed}"`);
  });

  await run_case("a page shown again from the back-forward cache loses the field focus it kept", async () => {
    const mark = events.length;
    await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of("controls", "blur_bf") + "&cacheable")}, active: true }).then(() => true)`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "blur_bf", "content script ready on blur_bf", 6000);
    await settle_focus();
    expect((await in_active_tab(`document.getElementById("first").focus(); document.activeElement.id`)) === "first", "the field took no focus");
    await in_active_tab(`addEventListener("pageshow", (event) => (document.documentElement.dataset.p24Persisted = String(event.persisted))); location.href = ${JSON.stringify(url_of("page", "blur_bf_next"))}; true`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "blur_bf_next", "content script ready on blur_bf_next", 6000);
    await settle_focus();
    const back_mark = events.length;
    await in_active_tab(`history.back(); true`);
    await wait_event(back_mark, (event) => event.type === "visibility" && event.page_id === "blur_bf" && event.state === "visible", "the cached page to turn visible", 6000);
    expect((await in_active_tab(`document.documentElement.dataset.p24Persisted`)) === "true", "the page came back from the network, not from the back-forward cache");
    await expect_blurred("blur_bf", "first");
    await expect_keys_work("blur_bf");
  });
}
