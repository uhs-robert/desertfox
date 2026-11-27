// Shared steps of the browser module pieces (p54_*). The module runs in chrome, and most of its pages run no content script, so these steps read Firefox from chrome code.
// Every run's Firefox is the private copy with the module in chrome.d (firefox_copy.mjs). The pieces turn the module on for their own cases and leave it off.
import { evaluate_in_browsing_context, evaluate_in_chrome } from "./rdp.mjs";

export const MODULE_PREF = "desertfox.browser_module.enabled";
const STATE_KEY = "desertfox_browser_module_state";
const STATUS_KEY = "desertfox_browser_module_status";
const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
// A key the module must not take shows no effect, so the check sits out this long. A taken key switches the tab in about 10 ms.
export const NO_EFFECT_MS = 500;

export function module_steps({ rdp, poll_until, run_line, press_keys, sleep, on_teardown, open_page, expect }) {
  const chrome = async (code) => {
    const value = await evaluate_in_chrome(rdp, code);
    if (value && typeof value === "object" && "error" in value && Object.keys(value).length === 1) throw new Error(`chrome code failed: ${value.error}`);
    return value;
  };
  const session_value = (key) =>
    chrome(`(async () => {
      const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
      const { extensionStorageSession } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorage.sys.mjs");
      const holder = extensionStorageSession.get(ExtensionParent.GlobalManager.getExtension("desertfox@uhs-robert"), [${JSON.stringify(key)}])[${JSON.stringify(key)}];
      return holder?.deserialize ? holder.deserialize(globalThis, true) : holder ?? null;
    })()`);
  const set_session_value = (key, value) =>
    chrome(`(async () => {
      const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
      const { ExtensionStorage, extensionStorageSession } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorage.sys.mjs");
      const extension = ExtensionParent.GlobalManager.getExtension("desertfox@uhs-robert");
      const value = ${JSON.stringify(value)};
      if (value === null) extensionStorageSession.remove(extension, [${JSON.stringify(key)}]);
      else extensionStorageSession.set(extension, { [${JSON.stringify(key)}]: ExtensionStorage.serialize("k", "k", value) });
    })()`);
  const module_status = () => chrome(`(async () => { const core = Services.desertfox_browser_module; return typeof core === "object" ? core.status() : core ?? null; })()`);
  const set_pref = (on) => chrome(on === undefined ? `Services.prefs.clearUserPref("${MODULE_PREF}")` : `Services.prefs.setBoolPref("${MODULE_PREF}", ${on})`);

  // The pref, the setting, then the state with J in it and a matched hello. Undone at the piece's end: the pref here, the setting by the harness's `:unset all`.
  async function turn_on_module() {
    on_teardown(() => set_pref(undefined));
    await set_pref(true);
    await run_line(":set browser_module true");
    await poll_until("the module state with J and a matched hello", async () => {
      const [state, status] = [await session_value(STATE_KEY), await session_value(STATUS_KEY)];
      return state?.keys?.some((row) => row.key === "J") && status?.result === "matched";
    }, { timeout_ms: 8000 });
  }

  // Opens `url` in a new selected tab of the most recent window from chrome, as a user would from the address bar, and waits until it has loaded.
  async function open_tab(url, { loaded = (spec) => spec !== "about:blank", wait_load = true } = {}) {
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.addTrustedTab(${JSON.stringify(url)}); })()`);
    if (wait_load) await wait_loaded(loaded);
  }
  async function wait_loaded(loaded = (spec) => spec !== "about:blank") {
    await poll_until("the tab to load", async () => {
      const { spec, loading } = await chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; return { spec: b.currentURI.spec, loading: b.webProgress.isLoadingDocument }; })()`);
      return !loading && loaded(spec);
    }, { timeout_ms: 10000 });
  }
  const selected_spec = () => chrome(`(async () => ${W}.gBrowser.selectedBrowser.currentURI.spec)()`);
  // The document of the selected tab: `code` is a function source taking its window, run in the process that holds it.
  async function in_selected_page(code) {
    const where = await chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; return { remote: b.isRemoteBrowser, context_id: b.browsingContext.id, pid: b.browsingContext.currentWindowGlobal?.domProcess?.osPid ?? null }; })()`);
    if (!where.remote) return chrome(`(async () => (${code})(${W}.gBrowser.selectedBrowser.browsingContext.window))()`);
    return evaluate_in_browsing_context(rdp, { context_id: where.context_id, pid: where.pid }, code);
  }
  // The keys go to the page, with no field focused: the browser element takes the focus, then the page drops its own focus.
  async function focus_page() {
    await chrome(`(async () => { const w = ${W}; w.focus(); w.gBrowser.selectedBrowser.focus(); })()`);
    await in_selected_page(`(win) => { win.document.activeElement?.blur?.(); win.focus(); return true; }`);
    await poll_until("the focus to leave every field", () => chrome(`(async () => ${W}.windowUtils.IMEStatus === Components.interfaces.nsIDOMWindowUtils.IME_STATUS_DISABLED)()`));
    // The frame script's report of the blur lands within a frame or two.
    await sleep(100);
  }
  // Every scroll offset of the shown document added up, so a move of the page or of any box in it shows.
  const page_scroll = () => in_selected_page(`(win) => { const doc = win.document; let sum = win.scrollX + win.scrollY; for (const node of doc.querySelectorAll("*")) sum += node.scrollTop + node.scrollLeft; return sum; }`);

  // Counts the tab switches in every browser window from now on.
  async function watch_switches() {
    await chrome(`(async () => {
      Services.desertfox_key_test_unwatch?.();
      let count = 0;
      const on_select = () => count++;
      const windows = [...Services.wm.getEnumerator("navigator:browser")];
      for (const w of windows) w.gBrowser.tabContainer.addEventListener("TabSelect", on_select);
      Services.desertfox_key_test_switches = () => count;
      Services.desertfox_key_test_unwatch = () => { for (const w of windows) if (!w.closed) w.gBrowser.tabContainer.removeEventListener("TabSelect", on_select); };
    })()`);
  }
  const switch_count = () => chrome(`(async () => Services.desertfox_key_test_switches())()`);
  on_teardown(() => chrome(`(async () => { Services.desertfox_key_test_unwatch?.(); delete Services.desertfox_key_test_unwatch; delete Services.desertfox_key_test_switches; })()`));

  // Presses the keys and expects exactly `expected` tab switches.
  async function press_and_count(keys, expected, what) {
    await watch_switches();
    await press_keys(...keys);
    if (expected > 0) await poll_until(`${what}: ${expected} tab switch`, async () => (await switch_count()) >= expected, { timeout_ms: 3000 });
    await sleep(expected > 0 ? 300 : NO_EFFECT_MS);
    const seen = await switch_count();
    expect(seen === expected, `${what}: expected ${expected} tab switch, saw ${seen}`);
  }
  const switches_one = (what, keys = ["J"]) => press_and_count(keys, 1, what);
  const switches_none = (what, keys = ["J"]) => press_and_count(keys, 0, what);

  async function scrolls(key, what, { down = true } = {}) {
    const before = await page_scroll();
    await press_keys(key);
    await poll_until(`${what}: ${key} to scroll`, async () => (down ? (await page_scroll()) > before : (await page_scroll()) < before), { timeout_ms: 3000 });
  }

  const close_selected_tab = () => chrome(`(async () => { const w = ${W}; if (w.gBrowser.tabs.length > 1) w.gBrowser.removeTab(w.gBrowser.selectedTab); })()`);
  // The tab switch keys need a tab to switch to, so every case starts from a DesertFox test page.
  const home = (id) => open_page("page", id, { new_tab: false });

  return { chrome, session_value, set_session_value, module_status, set_pref, turn_on_module, open_tab, wait_loaded, selected_spec, in_selected_page, focus_page, page_scroll, watch_switches, switch_count, switches_one, switches_none, scrolls, close_selected_tab, home };
}

// The command line panel (browser_module/desertfox-cmdline-panel.js) of the most recent window, read from chrome, and its page read in its own process.
export function panel_steps({ rdp, poll_until, press_keys }, { chrome }) {
  const PANEL = `${W}.document.getElementById("desertfox-cmdline-panel")`;
  const state = () =>
    chrome(`(async () => {
      const panel = ${PANEL};
      const browser = panel?.querySelector("browser");
      const principal = browser?.browsingContext?.currentWindowGlobal?.documentPrincipal;
      return {
        state: panel ? panel.state : "none",
        url: browser?.currentURI?.spec ?? null,
        remote_type: browser?.remoteType ?? null,
        system: principal ? principal.isSystemPrincipal : null,
        addon: principal?.addonId ?? null,
        private_id: browser?.browsingContext?.originAttributes?.privateBrowsingId ?? null,
        focused: Services.focus.focusedElement === browser,
        height: browser ? Math.round(browser.getBoundingClientRect().height) : 0,
      };
    })()`);
  async function in_panel(code) {
    const where = await chrome(`(async () => { const context = ${PANEL}?.querySelector("browser")?.browsingContext; return context?.currentWindowGlobal ? { context_id: context.id, pid: context.currentWindowGlobal.domProcess.osPid } : null; })()`);
    return where ? evaluate_in_browsing_context(rdp, where, code) : null;
  }
  const line_text = () => in_panel(`(win) => win.document.querySelector("#line")?.value ?? null`);
  // Open, on DesertFox's own page with its principal, and the line's input holds the focus.
  async function wait_open(what) {
    await poll_until(`${what} to open the command line panel`, async () => {
      const shown = await state();
      return shown.state === "open" && shown.url?.endsWith("/cmdline.html") && shown.focused && (await in_panel(`(win) => win.document.hasFocus() && win.document.activeElement?.id === "line"`)) === true;
    }, { timeout_ms: 8000 });
    // A key typed just after the panel took the focus can miss the line. A probe key that nothing binds shows when the keys arrive.
    const before = await line_text();
    await poll_until(`${what}: the panel to take typed keys`, async () => {
      if ((await line_text()) === before) await press_keys("|");
      return /^\|+$/.test((await line_text())?.slice(before.length) ?? "");
    }, { timeout_ms: 5000 });
    const probes = (await line_text()).length - before.length;
    for (let probe = 0; probe < probes; probe++) await press_keys("-k", "BackSpace");
    await poll_until(`${what}: the probe key to leave the line`, async () => (await line_text()) === before);
    return state();
  }
  // Waits for the line to hold `text`, and names what it holds when it never does.
  async function line_holds(text) {
    try {
      await poll_until(`the panel line to hold ${text}`, async () => (await line_text()) === text);
    } catch (error) {
      throw new Error(`${error.message}: it holds ${JSON.stringify(await line_text())}`, { cause: error });
    }
  }
  return { state, in_panel, line_text, line_holds, wait_open };
}

// A PDF of `pages` pages of text lines, so the viewer's page box scrolls.
export function make_pdf(pages = 6) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let page = 0; page < pages; page++) {
    const lines = Array.from({ length: 40 }, (_, line) => `BT /F1 12 Tf 72 ${760 - line * 18} Td (Page ${page + 1} line ${line + 1}) Tj ET`).join("\n");
    objects.push(`<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`);
    const content = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

// An article long enough for Reader View, with its text in paragraphs.
export const make_article = () =>
  `<!doctype html><html><head><meta charset="utf-8"><title>A long article</title></head><body><article><h1>A long article</h1>${Array.from({ length: 60 }, (_, index) => `<p>Paragraph ${index + 1}. The desert fox walks at night across the dunes, and the sand keeps the heat of the day for a long time after the sun goes down. It hunts small animals and eats fruit when it finds some.</p>`).join("\n")}</article></body></html>`;
