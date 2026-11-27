// What keeps the browser module out: its pref, the toolbar switch, another protocol version, no state (an extension reload empties it), DevTools, and a document that replaced a DesertFox page.
// Also that it follows a remapped key and that a second window gets it once and loses it on close.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["tabs", "keys", "toolbar"];

const STATE_KEY = "desertfox_browser_module_state";
const TOGGLE = ["-M", "ctrl", "-M", "alt", "d", "-m", "alt", "-m", "ctrl"];
const W = `Services.wm.getMostRecentWindow("navigator:browser")`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, on_teardown, config_copy, config_dir, load_config_dir, sleep } = context;
  const steps = module_steps(context);
  const { chrome, session_value, set_session_value, module_status, set_pref, open_tab, focus_page, switches_one, switches_none, close_selected_tab, home, in_selected_page, page_scroll } = steps;
  const state_now = () => session_value(STATE_KEY);
  const selected_index = () => chrome(`(async () => ${W}.gBrowser.tabContainer.selectedIndex)()`);
  const select_index = (index) => chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[${index}]; })()`);
  // A test page, then about:support, the page the gates are tried on.
  async function on_support(id) {
    await home(id);
    await open_tab("about:support");
    await focus_page();
  }

  await setup("turn the module on", () => steps.turn_on_module());

  await run_case("with the pref off or unset the module takes nothing, and turning it on again takes J at once", async () => {
    await on_support("bm_pref");
    await set_pref(false);
    await switches_none("J with the pref off");
    await set_pref(undefined);
    await switches_none("J with the pref unset");
    await set_pref(true);
    await switches_one("J with the pref on again");
    await switches_one("K back", ["K"]);
    await close_selected_tab();
  });

  await run_case("with the toolbar switch off the module takes nothing", async () => {
    await on_support("bm_switch");
    on_teardown(async () => {
      if ((await state_now())?.enabled === false) await press_keys(...TOGGLE);
    });
    await press_keys(...TOGGLE);
    await poll_until("the state to say off", async () => (await state_now())?.enabled === false && (await state_now()).keys.length === 0);
    await switches_none("J with DesertFox off");
    await press_keys(...TOGGLE);
    await poll_until("the state to say on with its keys back", async () => (await state_now())?.enabled === true && (await state_now()).keys.some((row) => row.key === "J"));
    await switches_one("J with DesertFox on again");
    await switches_one("K back", ["K"]);
    await close_selected_tab();
  });

  await run_case("a state of another protocol version, or none at all as after an extension reload, takes nothing", async () => {
    await on_support("bm_version");
    const written = await state_now();
    on_teardown(() => set_session_value(STATE_KEY, written));
    await set_session_value(STATE_KEY, { ...written, v: written.v + 1 });
    await switches_none("J with a state of the next version");
    await set_session_value(STATE_KEY, null);
    await switches_none("J with no state");
    await set_session_value(STATE_KEY, { ...written, added_later: { anything: true } });
    await switches_one("J with a state that holds a field the module does not know");
    await switches_one("K back", ["K"]);
    await close_selected_tab();
  });

  await run_case("the module follows a remapped J and a key bound to tab.next", async () => {
    await home("bm_remap");
    const dir = config_copy();
    writeFileSync(join(dir, "keymap.d", "90-browser-module.toml"), '[normal]\nJ = "tab.prev"\nL = "tab.next"\n');
    on_teardown(() => load_config_dir(config_dir));
    await load_config_dir(dir);
    await poll_until("the state to hold the remap", async () => {
      const keys = (await state_now())?.keys ?? [];
      return keys.some((row) => row.key === "J" && row.id === "tab.prev") && keys.some((row) => row.key === "L" && row.id === "tab.next");
    });
    await open_tab("about:support");
    await open_tab("about:license");
    await select_index(1);
    await focus_page();
    await switches_one("the remapped J");
    expect((await selected_index()) === 0, `J went to tab ${await selected_index()}, not back to the test page`);
    await select_index(1);
    await focus_page();
    await switches_one("L bound to tab.next", ["L"]);
    expect((await selected_index()) === 2, `L went to tab ${await selected_index()}, not on to about:license`);
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); })()`);
  });

  await run_case("a tab that leaves a DesertFox page for about:support gets the module, so the old page's live mark is gone", async () => {
    await home("bm_stale_home");
    await context.open_page("page", "bm_stale_live", { new_tab: true });
    const tab_id = await chrome(`(async () => { const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs"); return ExtensionParent.apiManager.global.tabTracker.getId(${W}.gBrowser.selectedTab); })()`);
    await poll_until("the live mark of the tab that holds the DesertFox page", async () => (await state_now())?.tabs?.[String(tab_id)]?.live === true);
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedBrowser.fixupAndLoadURIString("about:support", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); })()`);
    await steps.wait_loaded((spec) => spec === "about:support");
    await focus_page();
    await switches_one("J on about:support after a DesertFox page");
    await switches_one("K back", ["K"]);
    await close_selected_tab();
  });

  await run_case("in DevTools the module takes no key: DevTools moves its own tree selection, the tab and the page stay", async () => {
    await home("bm_devtools");
    await open_tab(`data:text/html,${encodeURIComponent("<!doctype html><main><p>one</p><p>two</p><p>three</p></main><div style='height:4000px'></div>")}`);
    on_teardown(() => chrome(`(async () => { const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools"); for (const tab of ${W}.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); })()`));
    // The first toolbox takes longer than one debugger call may run, so the call starts it and the case waits for it.
    const devtools = `const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools");`;
    await chrome(`(async () => { ${devtools} Services.desertfox_key_test_toolbox = gDevTools.showToolboxForTab(${W}.gBrowser.selectedTab, { toolId: "inspector" }).then(() => "open", (error) => String(error)); })()`);
    on_teardown(() => chrome(`(async () => { delete Services.desertfox_key_test_toolbox; })()`));
    await poll_until("the Inspector to open", () => chrome(`(async () => { ${devtools} const inspector = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab)?.getPanel("inspector"); return !!inspector?.markup && !!inspector.walker; })()`), { timeout_ms: 15000 });
    await chrome(`(async () => {
      ${devtools}
      const inspector = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab).getPanel("inspector");
      const node = await inspector.walker.querySelector(inspector.walker.rootNode, "p");
      await inspector.selection.setNodeFront(node, { reason: "test" });
      inspector.markup.doc.defaultView.focus();
      inspector.markup.getContainer(node).focus();
    })()`);
    const selected = () => chrome(`(async () => { const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools"); return gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab).getPanel("inspector").selection.nodeFront?.actorID ?? null; })()`);
    const focus_in_devtools = () => chrome(`(async () => { const focused = ${W}.document.commandDispatcher.focusedWindow; return String(focused?.location?.href ?? ""); })()`);
    expect(/devtools/.test(await focus_in_devtools()), `the focus is not in DevTools: ${await focus_in_devtools()}`);
    const before = await selected();
    const scroll_before = await page_scroll();
    await switches_none("J in the Inspector tree");
    await switches_none("j in the Inspector tree", ["j"]);
    expect((await page_scroll()) === scroll_before, "j scrolled the page under DevTools");
    await press_keys("-k", "Down");
    await poll_until("Down to move the Inspector selection", async () => (await selected()) !== before);
    const after_down = await selected();
    await press_keys("-k", "Up");
    await poll_until("Up to move the Inspector selection back", async () => (await selected()) !== after_down);
  });

  await run_case("a second window gets the module once, and closing it takes its listener away", async () => {
    await home("bm_windows");
    const frame_scripts = () => chrome(`(async () => Services.mm.getDelayedFrameScripts().filter(([url]) => decodeURIComponent(url).includes("desertfox-browser-module")).length)()`);
    const scripts_before = await frame_scripts();
    expect(scripts_before === 2, `the module registered ${scripts_before} frame scripts, not 2`);
    const windows_before = (await module_status()).windows;
    await chrome(`(async () => { const w = ${W}.OpenBrowserWindow(); await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished")); })()`);
    await poll_until("the new window to get the module", async () => (await module_status()).windows === windows_before + 1);
    expect((await frame_scripts()) === scripts_before, "a second window registered the frame scripts again");
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.addTrustedTab("about:support"); })()`);
    await poll_until("about:support in the new window", async () => (await steps.selected_spec()) === "about:support");
    await focus_page();
    await switches_one("J in the second window");
    await chrome(`(async () => ${W}.close())()`);
    await poll_until("the closed window to lose the module", async () => (await module_status()).windows === windows_before);
    await sleep(100);
  });
}
