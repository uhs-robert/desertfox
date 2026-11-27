// The hint keys where hints cannot run: with browser_module_pages off, the module claims them on the PDF viewer and Reader View and DesertFox says to turn the setting on, once per document. On about:preferences it says hints do not run there.
// Also about:addons, that the setting turning on gives the keys to the page code, and that the about:preferences search box still takes f as text.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { make_article, make_linked_pdf, module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["hints", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const CONFIG_SNAPSHOT_KEY = "desertfox_browser_module_snapshot_config";
const FROM_MODULE_KEY = "desertfox_browser_module_from_module";
// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;
const HINT_LABEL_COUNT = `(win) => {
  const host = [...win.document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}");
  return host?.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint").length ?? 0;
}`;
const PAGES_NOTICE = "Hints here need :set browser_module_pages true";
const NOT_HERE_NOTICE = "Hints do not run on this page";

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, run_line, in_background, clear_notices, on_teardown } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, focus_page, in_selected_page, close_selected_tab, home } = steps;
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(make_article().replace("</article>", `<p>The end: <a href="/target">the target link</a>.</p></article>`)));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-hint-notice-"));
  writeFileSync(join(files_dir, "linked.pdf"), make_linked_pdf(`${origin}/target`), "latin1");
  const pages = {
    "the PDF viewer": { url: pathToFileURL(join(files_dir, "linked.pdf")).href, ready: `(win) => !!win.document.querySelector(".annotationLayer a[href]")` },
    "Reader View": { url: `about:reader?url=${encodeURIComponent(`${origin}/article`)}`, ready: `(win) => !!win.document.querySelector('.moz-reader-content a[href$="/target"]')` },
  };

  const hint_labels = () => in_selected_page(HINT_LABEL_COUNT);
  const notices = async () => Object.values((await in_background(`browser.notifications.getAll()`)) ?? {}).map((notice) => notice.message);
  const hint_runs = async () => ((await session_value(FROM_MODULE_KEY)) ?? []).filter((message) => message.kind === "run" && /^(f|F)$/.test(message.args?.keys));
  const select_index = (index) => chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[${index}]; })()`);
  const pages_setting_on = async () => (await session_value(CONFIG_SNAPSHOT_KEY))?.value?.settings?.browser_module_pages === true;
  // Only a case that failed with the setting on gets here with work. The command line opens from the home page, the first tab, so it comes to the front first.
  const pages_off_at_teardown = async () => {
    if (!(await pages_setting_on())) return;
    await select_index(0);
    await focus_page();
    await pages_setting(false);
  };
  const pages_setting = async (on) => {
    await run_line(`:set browser_module_pages ${on}`);
    await poll_until(`the config snapshot with the setting ${on ? "on" : "off"}`, async () => (await pages_setting_on()) === on);
  };

  await setup("turn the module on, with browser_module_pages off", async () => {
    await steps.turn_on_module();
    expect((await session_value(CONFIG_SNAPSHOT_KEY)) === null, "the setting is off, so no config snapshot is written");
  });

  for (const name of Object.keys(pages)) {
    const id = name.replace(/\W+/g, "_");
    await run_case(`with the setting off, f on ${name} shows the notice once and no hints, and the setting on makes hints work`, async () => {
      await home(`hn_${id}`);
      await open_tab(pages[name].url);
      await poll_until(`${name} to draw`, () => in_selected_page(pages[name].ready), { timeout_ms: 10000 });
      await focus_page();
      await clear_notices();
      on_teardown(clear_notices);
      const runs_before = (await hint_runs()).length;
      await press_keys("f");
      await poll_until(`the notice on ${name}`, async () => (await notices()).includes(PAGES_NOTICE), { timeout_ms: 5000 });
      expect((await hint_labels()) === 0, `${name} showed hint labels with the setting off`);
      await clear_notices();
      await focus_page();
      await press_keys("f");
      await sleep(NO_EFFECT_MS);
      expect((await hint_runs()).length === runs_before + 1, `the module sent ${(await hint_runs()).length - runs_before} hint keys, not one`);
      expect((await notices()).length === 0, `a second f showed ${JSON.stringify(await notices())}`);
      // The command line opens from a DesertFox page, the first tab.
      await select_index(0);
      on_teardown(pages_off_at_teardown);
      await pages_setting(true);
      await select_index(1);
      await poll_until(`the page code to start on ${name} with no reload`, () => in_selected_page(`(win) => win.document.documentElement?.hasAttribute("data-desertfox-tree-read-ms") ?? false`), { timeout_ms: 8000 });
      await focus_page();
      await press_keys("f");
      await poll_until(`hint labels on ${name} with the setting on`, async () => (await hint_labels()) > 0, { timeout_ms: 5000 });
      await press_keys("-k", "Escape");
      await close_selected_tab();
      await select_index(0);
      await pages_setting(false);
    });
  }

  await run_case("on about:addons f says hints do not run there, and shows no hints", async () => {
    await home("hn_addons");
    await open_tab("about:addons");
    await poll_until("about:addons to load", () => in_selected_page(`(win) => win.document.readyState === "complete"`));
    await focus_page();
    await clear_notices();
    on_teardown(clear_notices);
    await press_keys("f");
    await poll_until("the notice on about:addons", async () => (await notices()).includes(NOT_HERE_NOTICE), { timeout_ms: 5000 });
    expect((await hint_labels()) === 0, "about:addons showed hint labels");
    await clear_notices();
    await close_selected_tab();
  });

  await run_case("on about:preferences the search box takes f as text, and f outside it says hints do not run there", async () => {
    await home("hn_prefs");
    await open_tab("about:preferences");
    await poll_until("the search box to hold the focus", () => chrome(`(async () => ${W}.windowUtils.IMEStatus === Components.interfaces.nsIDOMWindowUtils.IME_STATUS_ENABLED)()`));
    await clear_notices();
    on_teardown(clear_notices);
    const runs_before = (await hint_runs()).length;
    await press_keys("f");
    const field_value = `(win) => { let node = win.document.activeElement; while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement; return node?.value ?? null; }`;
    await poll_until("f in the search box", async () => (await in_selected_page(field_value)) === "f");
    await sleep(NO_EFFECT_MS);
    expect((await hint_runs()).length === runs_before && (await notices()).length === 0, "f in the search box was claimed");
    await in_selected_page(`(win) => { let node = win.document.activeElement; while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement; node?.blur(); return true; }`);
    await poll_until("the focus out of the search box", () => chrome(`(async () => ${W}.windowUtils.IMEStatus !== Components.interfaces.nsIDOMWindowUtils.IME_STATUS_ENABLED)()`));
    await press_keys("f");
    await poll_until("the notice on about:preferences", async () => (await notices()).includes(NOT_HERE_NOTICE), { timeout_ms: 5000 });
    await clear_notices();
    await close_selected_tab();
  });
}
