// Probe: held Shift+J and K over login and prompt pages with blur_on_load and the module on. Logs the state of every dead tab and what revives it.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate_in_chrome } from "./rdp.mjs";
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "config", "tabs"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;

export async function run_cases(context) {
  const { config_copy, load_config_dir, setup, run_case, open_page, send_keys, press_keys, in_background, in_active_tab, wait_event, tab_switch_mark, tabs_shown_since, poll_until, settle_focus, events, expect, sleep, rdp, close_tabs_with } = context;
  const log = (line) => console.log(`[p25] ${line}`);
  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  const page_id_now = () => in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => new URL(tab.url).searchParams.get("id"))`);
  const tab_order = () => in_background(`browser.tabs.query({ currentWindow: true }).then((tabs) => tabs.map((tab) => URL.canParse(tab.url) ? new URL(tab.url).searchParams.get("id") : tab.url))`);
  const tab_id_of = (page_id) => in_background(`browser.tabs.query({}).then((tabs) => tabs.find((tab) => URL.canParse(tab.url) && new URL(tab.url).searchParams.get("id") === ${JSON.stringify(page_id)})?.id)`);
  const chrome_state = () =>
    evaluate_in_chrome(
      rdp,
      `(async () => {
        const fm = Services.focus; const w = ${W}; const b = w.gBrowser.selectedBrowser; const el = fm.focusedElement; const core = Services.desertfox_browser_module;
        const popups = [...w.document.querySelectorAll("panel, menupopup")].filter((p) => p.state === "open" || p.state === "showing").map((p) => p.id || p.localName);
        const report = await new Promise((resolve) => {
          const mm = b.messageManager; let done = false;
          const on = ({ data }) => { if (done) return; done = true; mm.removeMessageListener("desertfox-browser-module:report", on); resolve(data); };
          mm.addMessageListener("desertfox-browser-module:report", on);
          mm.sendAsyncMessage("desertfox-browser-module:report-now");
          w.setTimeout(() => on({ data: "no report" }), 500);
        });
        const tab_modes = await (async () => {
          const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
          const ext = ExtensionParent.GlobalManager.getExtension("desertfox@uhs-robert");
          const tab_id = ExtensionParent.apiManager.global.tabTracker.getId(w.gBrowser.selectedTab);
          return { tab_id };
        })();
        return { focused_window_is_browser: fm.focusedWindow === w, focused: el ? el.localName + "#" + (el.id || "") : null, focused_is_selected: el === b, active: fm.activeWindow === w, ime: w.windowUtils.IMEStatus, held_by: core?.keys_held_by?.(w) ?? null, module_pending: core?.module_pending?.(w) ?? null, popups, report, inner: b.innerWindowID, switcher: w.gBrowser._switcher ? { requested: w.gBrowser._switcher.requestedTab?.label, visible: w.gBrowser._switcher.visibleTab?.label } : null, selected_label: w.gBrowser.selectedTab.label, layers: b.renderLayers, has_layers: b.hasLayers, active_docshell: b.docShellIsActive, ...tab_modes };
      })()`,
    ).catch((error) => `error ${error.message}`);
  const page_state = async () =>
    in_active_tab(`JSON.stringify({ id: new URLSearchParams(location.search).get("id"), focus: document.activeElement?.id || document.activeElement?.localName, has_focus: document.hasFocus(), refocus_count: window.wrappedJSObject?.refocus_count, typed: [...document.querySelectorAll("input, [contenteditable]")].map((f) => f.value ?? f.textContent).join(""), scroll: scrollY, mode: document.documentElement.getAttribute("data-desertfox-mode") })`).catch((error) => `error ${error.message}`);
  const typed_anywhere = () => in_background(`(async () => { let text = ""; for (const tab of await browser.tabs.query({ currentWindow: true })) text += (await browser.tabs.executeScript(tab.id, { code: '[...document.querySelectorAll("input, [contenteditable]")].map((f) => f.value ?? f.textContent).join("")' }).catch(() => [""]))[0]; return text; })()`);
  const record_of = async (page_id) => in_background(`(async () => { const id = ${await tab_id_of(page_id)}; const all = await browser.storage.local.get(null); return JSON.stringify(Object.fromEntries(Object.entries(all).filter(([k]) => k.endsWith("_" + id) || k.endsWith(":" + id) || k.endsWith(String(id))))); })()`);

  const scroll_y = () => in_active_tab("scrollY").catch(() => -1);
  const scrolls_now = async () => {
    const before = await scroll_y();
    await press_keys("j");
    for (let i = 0; i < 7; i++) {
      await sleep(100);
      if ((await scroll_y()) > before) return true;
    }
    return false;
  };
  const keys_work = async () => {
    for (let attempt = 0; attempt < 2; attempt++) if (await scrolls_now()) return "scroll";
    const switch_mark = await tab_switch_mark();
    await press_keys("J");
    await sleep(600);
    return (await tabs_shown_since(switch_mark)).length > 0 ? "switch" : false;
  };
  const hold = async (key, ms) => {
    const switch_mark = await tab_switch_mark();
    await send_keys("-M", "shift", "-P", key, "-s", String(ms), "-p", key, "-m", "shift");
    await sleep(400);
    return tabs_shown_since(switch_mark);
  };
  const tap = async (key, times, gap) => {
    const switch_mark = await tab_switch_mark();
    for (let i = 0; i < times; i++) {
      await press_keys(key);
      await sleep(gap);
    }
    await sleep(400);
    return tabs_shown_since(switch_mark);
  };
  const select = async (page_id) => {
    await in_background(`browser.tabs.update(${await tab_id_of(page_id)}, { active: true }).then(() => true)`);
    await poll_until(`tab ${page_id} active`, async () => (await page_id_now()) === page_id);
  };
  const dump = async (page_id, what) => log(`${what} ${page_id}: badge ${badge_of(page_id)} page ${await page_state()} chrome ${JSON.stringify(await chrome_state())} record ${await record_of(page_id)}`);

  // Right where the burst stopped: the tab it left selected.
  const check_here = async (what) => {
    const page_id = await page_id_now();
    await sleep(1200);
    await dump(page_id, `${what} stop tab before`);
    const shown = await page_state();
    const works = await keys_work();
    log(`${what} stop tab ${page_id}: ${works || "DEAD"}`);
    if (!works) await revive(page_id);
    return works;
  };
  const revive = async (page_id) => {
    await dump(page_id, "DEAD");
    await press_keys("-k", "Escape");
    await sleep(300);
    log(`revive Escape: ${(await keys_work()) || "dead"}`);
    await evaluate_in_chrome(rdp, `(async () => { const w = ${W}; const b = w.gBrowser.selectedBrowser; const box = b.getBoundingClientRect(); const at = [(w.mozInnerScreenX + box.left + 400) * w.devicePixelRatio, (w.mozInnerScreenY + box.top + 400) * w.devicePixelRatio]; for (const m of [w.windowUtils.NATIVE_MOUSE_MESSAGE_MOVE, w.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_DOWN, w.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_UP]) { w.windowUtils.sendNativeMouseEvent(at[0], at[1], m, 0, 0, b, null); await new Promise((r) => w.setTimeout(r, 20)); } })()`);
    await sleep(300);
    log(`revive click: ${(await keys_work()) || "dead"}`);
    await dump(page_id, "after click");
    await in_background(`browser.tabs.reload(${await tab_id_of(page_id)}).then(() => true)`);
    await sleep(2500);
    log(`revive reload (2.5 s later): ${(await keys_work()) || "dead"}`);
    await dump(page_id, "after reload");
    await evaluate_in_chrome(rdp, `(async () => { const g = ${W}.gBrowser; const here = g.selectedTab; g.selectedTab = here.previousElementSibling ?? g.tabs[0]; await new Promise((r) => setTimeout(r, 300)); g.selectedTab = here; })()`);
    await sleep(1500);
    log(`revive switch (1.5 s later): ${(await keys_work()) || "dead"}`);
    await dump(page_id, "after switch");
  };

  const ROW = [
    ["page", "a"],
    ["refocus", "login_auto"],
    ["refocus", "ce_auto_vis"],
    ["refocus", "login_auto_vis"],
    ["refocus", "ce_late_vis"],
    ["refocus", "login_late"],
    ["refocus", "ce_auto"],
    ["refocus", "login_auto_vis_blurt_heavy"],
    ["refocus", "ce_auto_vis_blurt_heavy"],
    ["page", "z"],
  ];

  await setup("load a config with a blur_on_load row", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://*/*?id=dn*"\nblur_on_load = true\n');
    await load_config_dir(dir);
  });
  const { turn_on_module } = module_steps(context);
  await setup("turn on the browser module", turn_on_module);
  await setup("turn on blur_on_load everywhere", () => context.run_line(":set blur_on_load true"));
  await setup("resolve the sN.test hosts to the page server", () => evaluate_in_chrome(rdp, `Services.prefs.setStringPref("network.dns.localDomains", ${JSON.stringify(Array.from({ length: 12 }, (_, i) => `s${i}.test`).join(","))})`));
  await setup("save a login for the page server", async () => {
    const port = await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => new URL(tab.url).port)`);
    for (const index of [1, 3, 5]) {
    const origin = `http://s${index}.test:${port}`;
    log(`origin ${origin}`);
    await evaluate_in_chrome(rdp, `(async () => { const info = Components.classes["@mozilla.org/login-manager/loginInfo;1"].createInstance(Components.interfaces.nsILoginInfo); info.init(${JSON.stringify(origin)}, ${JSON.stringify(origin)}, null, "user@example.com", "hunter2", "email", "password"); await Services.logins.addLoginAsync(info); return true; })()`);
    }
  });

  for (const [prefix, how] of [["dn1_", "hold"], ["dn2_", "tap"]]) {
    await setup(`open the ${prefix} row`, async () => {
      const base = new URL(await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.url)`));
      for (const [index, [kind, id]] of ROW.entries()) {
        const url = `http://s${index}.test:${base.port}/${kind}?id=${prefix}${id}`;
        await in_background(`browser.tabs.create({ url: ${JSON.stringify(url)}, active: true }).then(() => true)`);
        await poll_until(`${id} loaded`, async () => (await in_active_tab("document.readyState").catch(() => "")) === "complete");
        await sleep(300);
      }
      await select(`${prefix}a`);
      await settle_focus().catch((error) => log(`settle failed: ${error.message}`));
    });
    for (let round = 0; round < 4; round++) {
      for (const key of ["J", "K"]) {
        await run_case(`${prefix} ${how} round ${round} ${key}: keys work where the burst stops`, async () => {
          const switched = how === "hold" ? await hold(key.toLowerCase(), 1200 + 300 * round) : await tap(key, 3 + round, 120);
          log(`round ${round} ${key} switched ${switched.length}: ${switched.join(",")}`);
          const works = await check_here(`round ${round} ${key}`);
          expect(works, `dead after round ${round} ${key}`);
        });
      }
    }
    log(`typed "${await typed_anywhere()}"`);
    await setup(`close the ${prefix} row`, async () => {
      await close_tabs_with(prefix);
      await settle_focus().catch(() => {});
    });
  }
}
