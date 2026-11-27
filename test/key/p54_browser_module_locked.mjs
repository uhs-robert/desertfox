// The browser module (browser_module/) on the pages it exists for: the tab keys and hjkl on about:preferences, about:addons, the PDF viewer and Reader View, a tab still loading, fields on those pages, blur_on_load on about:preferences, and a DesertFox page where it must stay out.
// Also its start: the run's Firefox copy holds a drop-in that throws at load before the module (firefox_copy.mjs), and Firefox must still work with the module loaded.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { make_article, make_pdf, module_steps } from "./browser_module_steps.mjs";

export const areas = ["tabs", "scroll"];

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, url_of, sleep, in_background, run_line } = context;
  const steps = module_steps(context);
  const { chrome, module_status, open_tab, focus_page, switches_one, switches_none, scrolls, page_scroll, in_selected_page, close_selected_tab, home } = steps;
  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-module-pages-"));
  writeFileSync(join(files_dir, "long.pdf"), make_pdf(6), "latin1");
  const file_url = (name) => pathToFileURL(join(files_dir, name)).href;
  // Reader View takes no file: or data: article, so this piece serves its own.
  const article_server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(make_article()));
  await new Promise((resolve) => article_server.listen(0, "127.0.0.1", resolve));
  context.on_teardown(() => new Promise((resolve) => article_server.close(resolve)));
  const article_url = `http://127.0.0.1:${article_server.address().port}/article`;

  await run_case("Firefox starts with a drop-in that throws at load, and the module loads after it into every window, idle with its pref unset", async () => {
    expect((await chrome(`(async () => Services.desertfox_key_test_throws_loaded ?? 0)()`)) >= 1, "the throwing drop-in never ran, so this case tests nothing");
    const status = await module_status();
    const windows = await chrome(`(async () => [...Services.wm.getEnumerator("navigator:browser")].length)()`);
    expect(status?.windows === windows, `the module holds ${JSON.stringify(status)} for ${windows} windows`);
    // An earlier piece on this Firefox can have turned the module on, which loads its frame scripts for the session. The pref decides each key, so the check below holds either way.
    expect((await chrome(`(async () => Services.prefs.prefHasUserValue("desertfox.browser_module.enabled"))()`)) === false, "the module's pref is set before this piece turned it on");
    expect(status.errors.length === 0, `the module logged: ${status.errors.join("; ")}`);
    await home("bm_start");
    await open_tab("about:support");
    await focus_page();
    await switches_none("J on about:support with the pref unset");
    await close_selected_tab();
  });

  await setup("turn the module on", () => steps.turn_on_module());

  // The list of add-ons is too short to scroll in a test profile, so the case makes it long.
  const lengthen = () => in_selected_page(`(win) => { const spacer = win.document.createElement("div"); spacer.style.height = "4000px"; (win.document.querySelector("#main") ?? win.document.body).append(spacer); return true; }`);
  for (const [page, url, scroll, prepare] of [
    ["about:preferences", "about:preferences", true],
    ["about:addons", "about:addons", true, lengthen],
    ["the PDF viewer", file_url("long.pdf"), true],
    ["Reader View", `about:reader?url=${encodeURIComponent(article_url)}`, true],
  ]) {
    await run_case(`J and K switch exactly one tab on ${page}${scroll ? ", and j and k scroll it" : ""}`, async () => {
      await home(`bm_from_${page.replace(/\W+/g, "_")}`);
      await open_tab(url);
      await prepare?.();
      // The PDF viewer and Reader View fill the page after the load.
      if (scroll) await poll_until(`${page} to have room to scroll`, () => in_selected_page(`(win) => [win.document.scrollingElement, ...win.document.querySelectorAll("*")].some((node) => node && node.scrollHeight > node.clientHeight + 200 && (node === win.document.scrollingElement || /auto|scroll/.test(win.getComputedStyle(node).overflowY)))`), { timeout_ms: 8000 });
      await focus_page();
      if (scroll) {
        await scrolls("j", page);
        await scrolls("k", page, { down: false });
        await scrolls("G", page);
      }
      await switches_one(`J on ${page}`);
      await switches_one(`K back to ${page}`, ["K"]);
      expect((await steps.selected_spec()).startsWith(url.split("?")[0]), `K did not come back to ${page}`);
      await close_selected_tab();
    });
  }

  await run_case("typed text reaches the field on about:preferences, and J there types", async () => {
    await home("bm_prefs_field");
    await open_tab("about:preferences");
    // The search box takes the focus when the page opens.
    await poll_until("the search box to hold the focus", () => chrome(`(async () => Services.wm.getMostRecentWindow("navigator:browser").windowUtils.IMEStatus === Components.interfaces.nsIDOMWindowUtils.IME_STATUS_ENABLED)()`));
    await switches_none("J in the about:preferences search box", ["JjkG"]);
    const typed = await in_selected_page(`(win) => { let node = win.document.activeElement; while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement; return node?.value ?? null; }`);
    expect(typed === "JjkG", `the search box holds ${JSON.stringify(typed)}`);
    await close_selected_tab();
  });

  await run_case("with blur_on_load on, about:preferences loses the search box focus it took on load, so J switches at once", async () => {
    await home("bm_prefs_blur");
    await run_line(":set blur_on_load true");
    try {
      await poll_until("the module state to carry blur_on_load", async () => (await steps.session_value("desertfox_browser_module_state"))?.blur_on_load === true);
      await open_tab("about:preferences");
      // The case before this one shows the page focusing its search box on load. Past the load window the focus must be out of it.
      await poll_until("about:preferences to finish loading", () => in_selected_page(`(win) => win.document.readyState === "complete"`));
      await sleep(1500);
      expect((await chrome(`(async () => Services.wm.getMostRecentWindow("navigator:browser").windowUtils.IMEStatus === Components.interfaces.nsIDOMWindowUtils.IME_STATUS_DISABLED)()`)) === true, "the search box kept the focus with blur_on_load on");
      await switches_one("J on about:preferences just after it opened");
      await close_selected_tab();
    } finally {
      // The command line opens from a DesertFox page.
      await home("bm_prefs_blur_end");
      await run_line(":set blur_on_load false");
    }
  });

  await run_case("a field on a page in a content process types, even for a key that comes right after the focus", async () => {
    await home("bm_remote_field");
    // A data: page runs no content script, so the module is the only one that could take the key.
    await open_tab(`data:text/html,${encodeURIComponent('<!doctype html><input id="f"><div style="height:4000px"></div>')}`);
    await focus_page();
    await in_selected_page(`(win) => { win.document.getElementById("f").focus(); return true; }`);
    await switches_none("J in the field", ["Jjk"]);
    const typed = await in_selected_page(`(win) => win.document.getElementById("f").value`);
    expect(typed === "Jjk", `the field holds ${JSON.stringify(typed)}`);
    expect((await page_scroll()) === 0, "j or k scrolled the page from the field");
    await close_selected_tab();
  });

  await run_case("h and l scroll a wide page sideways", async () => {
    await home("bm_wide");
    await open_tab(`data:text/html,${encodeURIComponent('<!doctype html><div style="width:5000px;height:4000px"></div>')}`);
    await focus_page();
    await scrolls("l", "a wide page");
    await scrolls("h", "a wide page", { down: false });
    await close_selected_tab();
  });

  await run_case("J in a new tab before its page commits switches exactly one tab", async () => {
    await home("bm_gap");
    const slow = `${new URL(url_of("page", "bm_gap")).origin}/slow_pixel?ms=4000`;
    await open_tab(slow, { wait_load: false });
    await poll_until("the new tab to show its first empty page", async () => (await steps.selected_spec()) === "about:blank");
    await switches_one("J in a tab that has not committed");
    await chrome(`(async () => { const w = Services.wm.getMostRecentWindow("navigator:browser"); const tab = [...w.gBrowser.tabs].find((t) => t.linkedBrowser.currentURI.spec === "about:blank" || t.linkedBrowser.currentURI.spec.includes("slow_pixel")); if (tab) w.gBrowser.removeTab(tab); })()`);
  });

  await run_case("the module hears the extension's message list and refuses a kind it does not know with an error reply", async () => {
    // No kind is on either list yet, so a refusal is the one answer a real Firefox can give. It runs the storage listener, the checks and the module's write.
    const id = `kt${Date.now().toString(36)}`;
    await steps.set_session_value("desertfox_browser_module_from_extension", [{ v: 1, id, kind: "no.such.kind", args: {}, sent_at: Date.now() }]);
    await poll_until("the module's refusal", async () => ((await steps.session_value("desertfox_browser_module_from_module")) ?? []).some((reply) => reply.reply_to === id && reply.ok === false && reply.error === "the kind is not on the allow list"));
    expect((await module_status()).errors.length === 0, `the module logged: ${(await module_status()).errors.join("; ")}`);
  });

  await run_case("on a DesertFox page J switches exactly one tab: DesertFox takes it and the module stays out", async () => {
    await home("bm_df_a");
    await context.open_page("page", "bm_df_b", { new_tab: true });
    await switches_one("J on a DesertFox page");
    // The module claims in the parent's capture phase, so a key it took never reaches the content script. The background times each command it runs, so a tab.next there is DesertFox's.
    const timed_switches = async () => ((await in_background(`browser.storage.session.get("desertfox_timings").then((got) => got.desertfox_timings ?? [])`)) ?? []).filter(([id]) => id === "tab.next").length;
    const before = await timed_switches();
    await switches_one("J on a DesertFox page, again");
    await poll_until("the background to time the tab.next it ran", async () => (await timed_switches()) > before);
    await sleep(200);
  });
}
