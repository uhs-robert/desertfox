// blur_on_load: a site row takes the focus away from a field the page focuses as it loads, until a key that is no repeat or a click, or about 1 s after the first install.
// The row lives in a config copy, so no other piece sees it. Cases that need the window still open skip the key probe of `open_page`, because its key press ends the window.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["keys", "config"];

const BLUR_WINDOW_MS = 1000;

export async function run_cases({ config_copy, load_config_dir, setup, on_teardown, run_case, open_page, press_keys, in_background, in_active_tab, wait_event, poll_until, settle_focus, events, url_of, scroll_of, expect, sleep, rdp }) {
  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  const focused_id = () => in_active_tab(`document.activeElement?.id ?? ""`);
  const page_state = async (page_id) => `badge ${badge_of(page_id)}, focus on "${await focused_id()}", activation ${await in_active_tab("navigator.userActivation.isActive")}, events ${JSON.stringify(events.filter((event) => event.page_id === page_id).map((event) => [event.type, event.label ?? event.key ?? event.id ?? ""]))}`;
  const with_state = (page_id, wait) => wait.catch(async (error) => { throw new Error(`${error.message}: ${await page_state(page_id)}`); });
  const focus_field = (id) => in_active_tab(`document.getElementById(${JSON.stringify(id)}).focus(); document.activeElement?.id ?? ""`);
  const expect_blurred = async (page_id, field_id) => {
    await with_state(page_id, poll_until(`NORMAL on ${page_id}`, async () => badge_of(page_id) === "NORMAL"));
    expect((await focused_id()) !== field_id, `the field still holds the focus: ${await page_state(page_id)}`);
  };

  await setup("load a config with a blur_on_load row for the blur_ pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=blur_*"\nblur_on_load = true\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=fol_*"\nblur_on_load = true\nfocus_on_load = "#last"\n');
    await load_config_dir(dir);
  });

  // Opens a tab and waits only for the content script's first install, so no key press ends the window. Returns when the install was reported.
  const open_without_keys = async (kind, id) => {
    const mark = events.length;
    await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of(kind, id))}, active: true }).then((tab) => tab.id)`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 6000);
    return Date.now();
  };
  const expect_in_window = (installed_at, what) => {
    const elapsed = Date.now() - installed_at;
    expect(elapsed < BLUR_WINDOW_MS - 100, `${what} came ${elapsed} ms after the install, too late to test the window`);
  };

  // A real mouse press through the widget, so the page gets trusted events and user activation, as from a mouse.
  // A press right after the load can miss while the new tab has not painted yet, so it repeats until the field holds the focus.
  const click_on = async (id) => {
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
      if ((await focused_id()) === id) return attempt;
      await sleep(40);
    }
    throw new Error(`no press reached the field: ${await page_state("blur_click")}`);
  };

  await run_case("a field the page focuses on load loses the focus, and a page with no row keeps it", async () => {
    await open_page("field", "blur_field", { new_tab: true });
    await expect_blurred("blur_field", "field");
    await open_page("field", "plain_field", { new_tab: true });
    await poll_until("INSERT on the page with no row", async () => badge_of("plain_field") === "INSERT");
  });

  await run_case("a field the page focuses before the reply loses the focus at the first install", async () => {
    // A script registered for this page focuses the field as the parser inserts it, before the background's reply, and records that order.
    const early_focus = `
      new MutationObserver((_, observer) => {
        const field = document.getElementById("first");
        if (!field) return;
        observer.disconnect();
        field.focus();
        document.documentElement.dataset.p24FocusBeforeInstall = String(!document.documentElement.hasAttribute("data-desertfox-tree-read-ms") && document.activeElement === field);
      }).observe(document, { childList: true, subtree: true });`;
    on_teardown(() => in_background(`globalThis.p24_early_focus?.unregister()`));
    await in_background(`browser.contentScripts.register({ matches: ["*://127.0.0.1/controls?id=blur_early*"], runAt: "document_start", js: [{ code: ${JSON.stringify(early_focus)} }] }).then((registered) => { globalThis.p24_early_focus = registered; })`);
    await open_without_keys("controls", "blur_early");
    expect((await in_active_tab(`document.documentElement.dataset.p24FocusBeforeInstall`)) === "true", `the page focus did not land before the first install: ${await in_active_tab(`document.documentElement.dataset.p24FocusBeforeInstall`)}`);
    await expect_blurred("blur_early", "first");
  });

  await run_case("a page focus inside the window is blurred, and one after it enters insert mode", async () => {
    const installed_at = await open_without_keys("controls", "blur_late");
    const held = await focus_field("first");
    expect_in_window(installed_at, "the page focus");
    expect(held !== "first", `a page focus inside the window kept the field: ${await page_state("blur_late")}`);
    await sleep(Math.max(0, installed_at + BLUR_WINDOW_MS + 200 - Date.now()));
    expect((await focus_field("first")) === "first", "a page focus after the window lost the field");
    await poll_until("INSERT after the window", async () => badge_of("blur_late") === "INSERT");
    await settle_focus();
  });

  await run_case("a bound key inside the window ends it, so a later page focus keeps the field", async () => {
    const installed_at = await open_without_keys("controls", "blur_key");
    // DesertFox takes j and cancels it, and the page still gets user activation from it. A key of the first moments is lost, so j repeats until it scrolls.
    for (let attempt = 0; ; attempt++) {
      const mark = events.length;
      await press_keys("j");
      if (await wait_event(mark, scroll_of("blur_key"), "a scroll from j", 300).then(() => true, () => false)) break;
      if (attempt >= 5) throw new Error(`j never scrolled: ${await page_state("blur_key")}`);
    }
    const held = await focus_field("first");
    expect_in_window(installed_at, "the page focus after the key");
    expect(held === "first", `the page focus after a key lost the field: ${await page_state("blur_key")}`);
    await poll_until("INSERT after the key", async () => badge_of("blur_key") === "INSERT");
  });

  await run_case("a click on a field inside the window keeps the focus there", async () => {
    const installed_at = await open_without_keys("controls", "blur_click");
    await click_on("first");
    expect_in_window(installed_at, "the click");
    await with_state("blur_click", poll_until("INSERT after the click", async () => badge_of("blur_click") === "INSERT"));
    expect((await focused_id()) === "first", `the field lost the focus after the click: ${await page_state("blur_click")}`);
  });

  await run_case("a focus_on_load field takes the focus in insert mode, also from a field the page focuses inside the window", async () => {
    const installed_at = await open_without_keys("controls", "fol_field");
    await with_state("fol_field", poll_until("the focus_on_load field in insert mode", async () => (await focused_id()) === "last" && badge_of("fol_field") === "INSERT"));
    const held = await focus_field("first");
    expect_in_window(installed_at, "the page focus");
    expect(held === "last", `the page focus kept its field: ${await page_state("fol_field")}`);
    await with_state("fol_field", poll_until("insert mode after the redirect", async () => badge_of("fol_field") === "INSERT"));
    // The page drops the keys of its first moments, and this case skipped the probe of open_page.
    await settle_focus();
    await press_keys("abc");
    await with_state("fol_field", poll_until("typing in the focus_on_load field", async () => (await in_active_tab(`document.getElementById("last").value`)) === "abc"));
  });

  await run_case("a focus_on_load field the page focuses itself inside the window keeps the focus and enters insert mode", async () => {
    // The checkbox holds the focus at the install, so the window gives the target no focus of its own and the page's focus on it is the first.
    const installed_at = await open_without_keys("controls", "fol_boxfocus");
    const held = await focus_field("last");
    expect_in_window(installed_at, "the page focus");
    expect(held === "last", `the page focus lost the focus_on_load field: ${await page_state("fol_boxfocus")}`);
    await with_state("fol_boxfocus", poll_until("insert mode on the self-focused focus_on_load field", async () => badge_of("fol_boxfocus") === "INSERT"));
  });

  await run_case("a click on a field before the keymap reply keeps the focus there, and typing reaches it", async () => {
    // The same page lays out the same, so the field's place is read on a first copy, while the background still answers.
    await open_page("controls", "blur_pre_layout", { new_tab: true });
    const [x, y] = await in_active_tab(`(() => { const box = document.getElementById("first").getBoundingClientRect(); return [box.left + 10, box.top + box.height / 2]; })()`);
    const url = url_of("controls", "blur_preclick");
    const mark = events.length;
    // A busy background holds the keymap reply back, while the page loads in its own process and takes the click.
    const busy = in_background(`(() => { const until = Date.now() + 4000; while (Date.now() < until); return true; })()`);
    await sleep(100);
    const loaded = await evaluate_in_chrome(rdp, `(async () => {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      const browser = win.gBrowser.selectedBrowser;
      win.gBrowser.fixupAndLoadURIString(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      const until = Date.now() + 2000;
      while ((!browser.currentURI.spec.includes("blur_preclick") || browser.webProgress.isLoadingDocument) && Date.now() < until) await new Promise((resolve) => win.setTimeout(resolve, 20));
      return browser.currentURI.spec.includes("blur_preclick");
    })()`);
    expect(loaded === true, "the page did not load while the background was busy");
    // A press of the first moments after the load can miss the page, so it repeats until the page reports the focus.
    const click_seen = () => events.slice(mark).some((event) => event.type === "focused" && event.page_id === "blur_preclick" && event.id === "first");
    for (let attempt = 0; attempt < 10 && !click_seen(); attempt++) {
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
      await sleep(150);
    }
    // Event order, not the time of this check: the reply may land in the wait after the press that worked.
    const click_index = events.slice(mark).findIndex((event) => event.type === "focused" && event.page_id === "blur_preclick" && event.id === "first");
    const replied_before_click = events.slice(mark, mark + (click_index < 0 ? events.length : click_index)).some((event) => event.type === "tree_read" && event.page_id === "blur_preclick");
    expect(click_seen() && !replied_before_click, `the click came too late: seen ${click_seen()}, reply already in ${replied_before_click}`);
    await busy;
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "blur_preclick", "content script ready on blur_preclick", 6000);
    await sleep(300);
    expect((await focused_id()) === "first", `the field lost the focus the user clicked into: ${await page_state("blur_preclick")}`);
    await press_keys("abc");
    await with_state("blur_preclick", poll_until("typing in the clicked field", async () => (await in_active_tab(`document.getElementById("first").value`)) === "abc"));
  });

  await run_case("a page reached from a page with user activation still blurs its field", async () => {
    await open_page("controls", "blur_from", { new_tab: true });
    // The key probe of open_page gave this page user activation. A navigation it starts must not hand that to the next page.
    expect(await in_active_tab("navigator.userActivation.isActive"), "the key probe gave the page no user activation");
    const mark = events.length;
    await in_active_tab(`location.href = ${JSON.stringify(url_of("field", "blur_next"))}`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "blur_next", "content script ready on blur_next", 6000);
    await expect_blurred("blur_next", "field");
  });
}
