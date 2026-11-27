// The browser module's commands feature (browser_module/desertfox-commands.js) on the pages it exists for: key sequences, counts and the address bar on about:preferences, about:addons, the PDF viewer and Reader View.
// Also what it must leave alone: f and / on about:addons, typed text, the toolbar switch, a DesertFox page. And that a remapped key follows and the ignore toggle gives j back to pdf.js.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { make_article, make_pdf, module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["tabs", "scroll", "keys", "cmdline"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const STATE_KEY = "desertfox_browser_module_state";
const SHIFT_ESCAPE = ["-M", "shift", "-k", "Escape", "-m", "shift"];
const TOGGLE = ["-M", "ctrl", "-M", "alt", "d", "-m", "alt", "-m", "ctrl"];

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, on_teardown, config_copy, config_dir, load_config_dir } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, wait_loaded, focus_page, switches_one, switches_none, selected_spec, in_selected_page, close_selected_tab, home } = steps;
  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-module-commands-"));
  writeFileSync(join(files_dir, "long.pdf"), make_pdf(6), "latin1");
  const pdf_url = pathToFileURL(join(files_dir, "long.pdf")).href;
  const article_server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(make_article()));
  await new Promise((resolve) => article_server.listen(0, "127.0.0.1", resolve));
  context.on_teardown(() => new Promise((resolve) => article_server.close(resolve)));
  const reader_url = `about:reader?url=${encodeURIComponent(`http://127.0.0.1:${article_server.address().port}/article`)}`;

  const tab_count = () => chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
  const window_count = () => chrome(`(async () => [...Services.wm.getEnumerator("navigator:browser")].length)()`);
  const selected_index = () => chrome(`(async () => ${W}.gBrowser.tabContainer.selectedIndex)()`);
  const select_index = (index) => chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[${index}]; })()`);
  const load_in_tab = async (url) => {
    await chrome(`(async () => ${W}.gBrowser.selectedBrowser.fixupAndLoadURIString(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }))()`);
    await wait_loaded((spec) => spec.startsWith(url.split("?")[0]));
  };
  // The PDF viewer and Reader View fill the page after the load. Every page here needs the keys to reach the page and the module's state to hold the tree.
  const page_ready = async (page) => {
    await poll_until(`${page} to draw its content`, () => in_selected_page(`(win) => win.document.readyState === "complete" && (win.document.body?.textContent?.length ?? 0) > 20`), { timeout_ms: 8000 });
    await focus_page();
  };
  const bar_state = () => chrome(`(async () => { const bar = ${W}.gURLBar; return { focused: bar.focused, value: bar.value }; })()`);
  const zoom = () => chrome(`(async () => ${W}.ZoomManager.getZoomForBrowser(${W}.gBrowser.selectedBrowser))()`);

  await setup("turn the module on, with the tree in its state", async () => {
    await steps.turn_on_module();
    await poll_until("the state to hold the key tree", async () => !!(await session_value(STATE_KEY))?.tree?.children?.x);
    const status = await steps.module_status();
    expect(status.features.includes("desertfox-commands.js"), `the module loaded ${status.features.join(", ")}`);
  });

  for (const [page, url] of [
    ["about:preferences", "about:preferences"],
    ["about:addons", "about:addons"],
    ["the PDF viewer", pdf_url],
    ["Reader View", reader_url],
  ]) {
    const id = page.replace(/\W+/g, "_");
    await run_case(`on ${page}: xx and u, H and L, gt, tn, 5J, <<, zi, wn, and : with df`, async () => {
      await home(`bmc_${id}`);
      // A page before this one, so H has somewhere to go, and a second tab of the page, so xx leaves the selection on it.
      await open_tab(url);
      await page_ready(page);
      await open_tab("about:robots");
      await load_in_tab(url);
      await page_ready(page);

      await press_keys("H");
      await poll_until(`H to go back to about:robots from ${page}`, async () => (await selected_spec()) === "about:robots");
      await focus_page();
      await press_keys("L");
      await wait_loaded((spec) => spec.startsWith(url.split("?")[0]));
      await page_ready(page);

      const tabs = await tab_count();
      await press_keys("xx");
      await poll_until(`xx to close the tab of ${page}`, async () => (await tab_count()) === tabs - 1);
      await page_ready(page);
      await press_keys("u");
      await poll_until(`u to bring the tab back on ${page}`, async () => (await tab_count()) === tabs);
      await sleep(300);
      expect((await tab_count()) === tabs, `u left ${await tab_count()} tabs, not ${tabs}`);
      await page_ready(page);

      const here = await selected_index();
      await switches_one(`gt on ${page}`, ["gt"]);
      await select_index(here);
      await focus_page();
      await switches_one(`tn on ${page}`, ["tn"]);
      await select_index(here);
      await focus_page();
      await steps.watch_switches();
      await press_keys("5J");
      await poll_until(`5J on ${page} to switch five times`, async () => (await steps.switch_count()) >= 5);
      await sleep(300);
      expect((await steps.switch_count()) === 5, `5J switched ${await steps.switch_count()} times`);
      await select_index(here);
      await focus_page();

      await press_keys("<<");
      await poll_until(`<< to move the tab of ${page} left`, async () => (await selected_index()) === here - 1);
      await focus_page();

      const zoom_before = await zoom();
      on_teardown(() => chrome(`(async () => { for (const w of Services.wm.getEnumerator("navigator:browser")) for (const tab of w.gBrowser.tabs) w.FullZoom.reset(tab.linkedBrowser); })()`));
      await press_keys("zi");
      if (url === pdf_url) {
        // The browser's zoom does not reach the PDF viewer's own scale, so the case checks only that the module sent zi on, and reads what became of it.
        const sent = async () => ((await session_value("desertfox_browser_module_from_module")) ?? []).find((message) => message.kind === "run" && message.args.keys === "z i");
        await poll_until("the module to send zi", async () => !!(await sent()));
        const id = (await sent()).id;
        await poll_until("DesertFox to answer zi", async () => ((await session_value("desertfox_browser_module_from_extension")) ?? []).some((message) => message.reply_to === id));
        await context.clear_notices();
      } else await poll_until(`zi to zoom in ${page}`, async () => (await zoom()) > zoom_before);
      await chrome(`(async () => ${W}.FullZoom.reset(${W}.gBrowser.selectedBrowser))()`);
      await focus_page();

      const windows = await window_count();
      const first_window = await chrome(`(async () => { Services.desertfox_key_test_first_window = ${W}; return true; })()`);
      expect(first_window, "the window was not kept");
      await press_keys("wn");
      await poll_until(`wn on ${page} to open a window`, async () => (await window_count()) === windows + 1);
      await chrome(`(async () => { const first = Services.desertfox_key_test_first_window; delete Services.desertfox_key_test_first_window; for (const w of Services.wm.getEnumerator("navigator:browser")) if (w !== first) w.close(); first.focus(); })()`);
      await poll_until("the new window to close", async () => (await window_count()) === windows);
      await focus_page();

      await press_keys(":");
      await poll_until(`: on ${page} to open the address bar with df`, async () => {
        const bar = await bar_state();
        return bar.focused && bar.value === "df ";
      });
      await steps.watch_switches();
      await press_keys("tab.next");
      await poll_until("the address bar to hold the command", async () => (await bar_state()).value === "df tab.next");
      await press_keys("-k", "Return");
      await poll_until(`df tab.next from ${page} to switch the tab`, async () => (await steps.switch_count()) === 1, { timeout_ms: 5000 });

      await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); })()`);
    });
  }

  await run_case("on about:addons f and / reach the page, and the module sends nothing for them", async () => {
    await home("bmc_addons_keys");
    await open_tab("about:addons");
    await page_ready("about:addons");
    await in_selected_page(`(win) => { win.document.documentElement.dataset.seen = ""; win.addEventListener("keydown", (event) => { win.document.documentElement.dataset.seen += event.key; }); return true; }`);
    const before = (await session_value("desertfox_browser_module_from_module")) ?? [];
    await press_keys("f");
    await press_keys("/");
    // Firefox puts the focus in the add-ons search box on /.
    await poll_until("f and / to reach about:addons", async () => (await in_selected_page(`(win) => win.document.documentElement.dataset.seen`)) === "f/");
    await sleep(NO_EFFECT_MS);
    const after = (await session_value("desertfox_browser_module_from_module")) ?? [];
    const runs = after.filter((message) => message.kind === "run" && !before.some((old) => old.id === message.id));
    expect(runs.length === 0, `the module sent ${JSON.stringify(runs)}`);
    await close_selected_tab();
  });

  await run_case("typed text in the about:preferences search box stays as typed, and none of it runs", async () => {
    await home("bmc_prefs_field");
    await open_tab("about:preferences");
    await poll_until("the search box to hold the focus", () => chrome(`(async () => ${W}.windowUtils.IMEStatus === Components.interfaces.nsIDOMWindowUtils.IME_STATUS_ENABLED)()`));
    const tabs = await tab_count();
    await switches_none("keys typed in the search box", ["xxgt5Jzi:"]);
    const typed = await in_selected_page(`(win) => { let node = win.document.activeElement; while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement; return node?.value ?? null; }`);
    expect(typed === "xxgt5Jzi:", `the search box holds ${JSON.stringify(typed)}`);
    expect((await tab_count()) === tabs && !(await bar_state()).focused, "a key typed in the search box ran a command");
    await close_selected_tab();
  });

  await run_case("with the toolbar switch off, xx and : do nothing on about:support", async () => {
    await home("bmc_switch");
    await open_tab("about:support");
    await focus_page();
    on_teardown(async () => {
      if ((await session_value(STATE_KEY))?.enabled === false) await press_keys(...TOGGLE);
    });
    await press_keys(...TOGGLE);
    await poll_until("the state to say off", async () => (await session_value(STATE_KEY))?.enabled === false);
    const tabs = await tab_count();
    await press_keys("xx:");
    await sleep(NO_EFFECT_MS);
    expect((await tab_count()) === tabs && !(await bar_state()).focused, "a key ran with DesertFox off");
    await press_keys(...TOGGLE);
    await poll_until("the state to say on", async () => (await session_value(STATE_KEY))?.tree !== undefined);
    await close_selected_tab();
  });

  await run_case("in the PDF viewer Shift+Escape gives j and J to pdf.js, and pressing it again takes them back", async () => {
    await home("bmc_ignore");
    await open_tab(pdf_url);
    await poll_until("the PDF to open with its pages", () => in_selected_page(`(win) => (win.wrappedJSObject?.PDFViewerApplication?.pagesCount ?? 0) > 1`), { timeout_ms: 8000 });
    await focus_page();
    const pdf_page = () => in_selected_page(`(win) => win.wrappedJSObject.PDFViewerApplication.page`);
    expect((await pdf_page()) === 1, `the PDF opened on page ${await pdf_page()}`);
    await press_keys(...SHIFT_ESCAPE);
    await sleep(100);
    await press_keys("j");
    await poll_until("pdf.js to take j to the next page", async () => (await pdf_page()) === 2);
    await switches_none("J in ignore mode");
    await press_keys(...SHIFT_ESCAPE);
    await switches_one("J after ignore mode ends");
    await close_selected_tab();
  });

  await run_case("on a DesertFox page xx closes exactly one tab: DesertFox takes it and the module stays out", async () => {
    await home("bmc_df_a");
    await context.open_page("page", "bmc_df_b", { new_tab: true });
    await context.open_page("page", "bmc_df_c", { new_tab: true });
    const tabs = await tab_count();
    await press_keys("xx");
    await poll_until("xx to close the tab", async () => (await tab_count()) === tabs - 1);
    await sleep(NO_EFFECT_MS);
    expect((await tab_count()) === tabs - 1, `xx closed ${tabs - (await tab_count())} tabs`);
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); })()`);
  });
  await run_case("last, as the config stays remapped to the end of the piece: a key remapped in the config follows on about:support, and the key it freed leaves the tree", async () => {
    await home("bmc_remap");
    const dir = config_copy();
    writeFileSync(join(dir, "keymap.d", "90-browser-module-commands.toml"), '[normal]\nQ = "tab.duplicate"\nxx = "page.blur"\n');
    on_teardown(() => load_config_dir(config_dir));
    await load_config_dir(dir);
    {
      await poll_until("the tree to hold Q and to have lost xx", async () => {
        const tree = (await session_value(STATE_KEY))?.tree;
        return tree?.children?.Q === "forward" && tree.children.x?.children?.x === undefined;
      });
      await open_tab("about:support");
      await focus_page();
      const tabs = await tab_count();
      await press_keys("Q");
      await poll_until("Q to duplicate the tab", async () => (await tab_count()) === tabs + 1);
      await focus_page();
      await press_keys("xx");
      await sleep(NO_EFFECT_MS);
      expect((await tab_count()) === tabs + 1, "xx still closed a tab after the remap freed it");
      await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); })()`);
    }
  });

}
