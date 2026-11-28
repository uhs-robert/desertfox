// The command line panel (browser_module/desertfox-cmdline-panel.js): DesertFox's own command line page in a panel over a locked page.
// On about:preferences `:` opens it with DesertFox's principal, Enter runs the line and closes it, Escape and a tab switch close it, and the module's keys stay out of it.
// A prompt key opens it with the command typed in, the address bar takes over when the module refuses the panel, and a private window gets a private line.
import { module_steps, NO_EFFECT_MS, panel_steps } from "./browser_module_steps.mjs";

export const areas = ["cmdline", "tabs", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const EXTENSION_ID = "desertfox@uhs-robert";

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, on_teardown } = context;
  const steps = module_steps(context);
  const panel = panel_steps(context, steps);
  const { chrome, open_tab, focus_page, home, close_selected_tab } = steps;
  const tab_count = () => chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
  const close_others = () => chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); })()`);
  const bar_state = () => chrome(`(async () => { const bar = ${W}.gURLBar; return { focused: bar.focused, value: bar.value }; })()`);
  // Where the focus is once the panel closed: on the page of the selected tab, not in the browser UI.
  const page_has_focus = () => chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; return Services.focus.focusedElement === b || b.contentDocument?.hasFocus?.() === true; })()`);
  const closes = (what) => poll_until(`${what} to close the panel`, async () => (await panel.state()).state === "none", { timeout_ms: 5000 });
  // Escape first closes the completion list, then the line, as on a web page.
  async function escape_until_closed() {
    for (let press = 0; press < 3 && (await panel.state()).state !== "none"; press++) {
      await press_keys("-k", "Escape");
      await sleep(300);
    }
    await closes("Escape");
  }
  // A case that failed with the panel open must not leave it holding the focus for the next case.
  const close_panel = () => chrome(`(async () => { for (const w of Services.wm.getEnumerator("navigator:browser")) w.document.getElementById("desertfox-cmdline-panel")?.hidePopup?.(); })()`);
  async function prefs_with_tab_after() {
    await close_panel();
    await home("bmp_home");
    await open_tab("about:preferences");
    await open_tab("about:robots");
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[1]; })()`);
    await focus_page();
  }

  await setup("turn the module on", () => steps.turn_on_module());


  await run_case("on about:preferences : opens DesertFox's own line with its principal, and tab.next with Enter switches the tab and closes it", async () => {
    await prefs_with_tab_after();
    await press_keys(":");
    const shown = await panel.wait_open(": on about:preferences");
    expect(shown.remote_type === "extension" && shown.system === false && shown.addon === EXTENSION_ID, `the panel page runs as ${JSON.stringify(shown)}`);
    const first_height = shown.height;
    await steps.watch_switches();
    // The panel follows the list: a word with no rows leaves the line alone, and the list comes back with the next word.
    await press_keys("qqqq");
    await poll_until("the panel to shrink to the line", async () => (await panel.state()).height < first_height);
    await press_keys("-k", "BackSpace", "-k", "BackSpace", "-k", "BackSpace", "-k", "BackSpace");
    await panel.line_holds("");
    await press_keys("tab.next");
    await panel.line_holds("tab.next");
    await press_keys("-k", "Return");
    await poll_until("Enter to switch the tab", async () => (await steps.switch_count()) === 1, { timeout_ms: 5000 });
    await closes("Enter");
    expect((await chrome(`(async () => ${W}.gBrowser.selectedBrowser.currentURI.spec)()`)) === "about:robots", "tab.next went elsewhere");
    await close_others();
  });

  await run_case("Escape closes the panel and the focus goes back to about:preferences", async () => {
    await prefs_with_tab_after();
    await press_keys(":");
    await panel.wait_open(":");
    await escape_until_closed();
    await poll_until("the focus to return to the page", page_has_focus);
    expect(!(await bar_state()).focused, "the focus went to the address bar");
    // The keys work again at once.
    await steps.switches_one("J after the panel closed");
    await close_others();
  });

  await run_case("switching tabs closes the panel", async () => {
    await prefs_with_tab_after();
    await press_keys(":");
    await panel.wait_open(":");
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; })()`);
    await closes("a tab switch");
    await close_others();
  });

  await run_case("the module's keys do not fire inside the panel: J, xx and gt are typed into the line", async () => {
    await prefs_with_tab_after();
    const tabs = await tab_count();
    await press_keys(":");
    await panel.wait_open(":");
    await steps.watch_switches();
    await press_keys("Jxxgt");
    await panel.line_holds("Jxxgt");
    await sleep(NO_EFFECT_MS);
    expect((await steps.switch_count()) === 0 && (await tab_count()) === tabs, "a module key ran while the panel had the focus");
    await escape_until_closed();
    await close_others();
  });

  // No probe key here: the second key goes out in the same press as `:`, while the panel is still on its way.
  await run_case("keys typed right after : wait for the line: :u reopens no tab and :xx closes none", async () => {
    await prefs_with_tab_after();
    // A closed tab for u to reopen.
    await chrome(`(async () => { const w = ${W}; w.gBrowser.removeTab(w.gBrowser.tabs[2], { animate: false }); w.gBrowser.selectedTab = w.gBrowser.tabs[1]; })()`);
    await poll_until("about:robots to close", async () => (await tab_count()) === 2);
    await focus_page();
    for (const typed of [":u", ":xx"]) {
      await press_keys(typed);
      // A key that ran on the page reopens or closes a tab, and the panel then closes or never opens.
      await poll_until(`${typed} to open the panel or change the tabs`, async () => (await tab_count()) !== 2 || (await panel.state()).state === "open", { timeout_ms: 8000 });
      await sleep(NO_EFFECT_MS);
      const tabs = await tab_count();
      expect(tabs === 2, `${typed} ran a key on the page under the line: ${tabs} tabs, not 2`);
      await escape_until_closed();
      await focus_page();
    }
    await close_others();
  });

  await run_case("a prompt key opens the panel with the command typed in", async () => {
    await prefs_with_tab_after();
    await press_keys("o");
    await panel.wait_open("o");
    await poll_until("the line to start with open", async () => (await panel.line_text())?.startsWith("open ") === true);
    await escape_until_closed();
    await close_others();
  });

  // The panel's own `search` reads @selection from the tab the line opened over, which has no content script. The query goes into a new tab's address.
  const search_tab_address = (word) => chrome(`(async () => { const w = ${W}; return w.gBrowser.tabs.map((tab) => [tab.linkedBrowser.currentURI.spec, tab.linkedBrowser.userTypedValue ?? ""].join(" ")).filter((text) => text.includes(${JSON.stringify(word)})).length; })()`);
  const select_on_preferences = (pick) =>
    chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; const doc = b.contentDocument; const selection = doc.defaultView.getSelection(); ${pick} return text; })()`);

  await run_case("a bare :search typed in the panel searches the text selected on about:preferences", async () => {
    await prefs_with_tab_after();
    const word = await select_on_preferences(`const el = doc.querySelector("#categories .category-name, .category-name"); selection.selectAllChildren(el); const text = el.textContent.trim();`);
    expect(word.length > 0, "nothing was selected on about:preferences");
    await press_keys(":");
    await panel.wait_open(":");
    await press_keys("search");
    await panel.line_holds("search");
    await press_keys("-k", "Return");
    await poll_until("the search to open a tab whose address holds the selected text", async () => (await search_tab_address(encodeURIComponent(word))) > 0, { timeout_ms: 10000 });
    await close_others();
  });

  await run_case("a bare :search typed in the panel searches the range selected in the search box of about:preferences", async () => {
    await prefs_with_tab_after();
    await chrome(`(async () => { const doc = ${W}.gBrowser.selectedBrowser.contentDocument; const box = doc.getElementById("searchInput"); box.focus(); box.value = "dfzzfield word"; const input = box.inputEl ?? box; input.setSelectionRange?.(2, 7); })()`);
    await press_keys(":");
    await panel.wait_open(":");
    await press_keys("search");
    await panel.line_holds("search");
    await press_keys("-k", "Return");
    await poll_until("the search to open a tab whose address holds the field range", async () => (await search_tab_address("zzfie")) > 0, { timeout_ms: 10000 });
    await close_others();
  });

  await run_case("when the module refuses the panel, : opens the address bar with df", async () => {
    await prefs_with_tab_after();
    // A stray element under the panel's id: the module refuses a second panel, as it would one it cannot open.
    await chrome(`(async () => { const doc = ${W}.document; const stray = doc.createXULElement("box"); stray.id = "desertfox-cmdline-panel"; stray.dataset.keyTest = "stray"; doc.documentElement.appendChild(stray); })()`);
    const remove_stray = () => chrome(`(async () => { for (const w of Services.wm.getEnumerator("navigator:browser")) w.document.querySelector('[data-key-test="stray"]')?.remove(); })()`);
    on_teardown(remove_stray);
    await press_keys(":");
    await poll_until(": to open the address bar with df", async () => {
      const bar = await bar_state();
      return bar.focused && bar.value === "df ";
    });
    await remove_stray();
    await press_keys("-k", "Escape", "-k", "Escape");
    await close_others();
  });

  await run_case("in a private window with private access the panel opens a private line", async () => {
    const private_access = () => chrome(`(async () => WebExtensionPolicy.getByID("${EXTENSION_ID}").privateBrowsingAllowed)()`);
    const set_private_access = (allowed) =>
      chrome(`(async () => {
        const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
        const { extension } = WebExtensionPolicy.getByID("${EXTENSION_ID}");
        const change = { permissions: ["internal:privateBrowsingAllowed"], origins: [] };
        await (${allowed} ? ExtensionPermissions.add("${EXTENSION_ID}", change, extension) : ExtensionPermissions.remove("${EXTENSION_ID}", change, extension));
      })()`);
    const close_private_windows = () => chrome(`(async () => { const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs"); for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (PrivateBrowsingUtils.isWindowPrivate(w)) w.close(); })()`);
    const access_before = await private_access();
    on_teardown(() => set_private_access(access_before));
    on_teardown(close_private_windows);
    await set_private_access(true);
    await poll_until("DesertFox to gain private window access", async () => (await private_access()) === true);
    await chrome(`(async () => {
      const w = Services.wm.getMostRecentWindow("navigator:browser").OpenBrowserWindow({ private: true });
      await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished"));
    })()`);
    await poll_until("the private window to show about:privatebrowsing", async () => (await chrome(`(async () => ${W}.gBrowser.selectedBrowser.currentURI.spec)()`)) === "about:privatebrowsing", { timeout_ms: 10000 });
    await focus_page();
    await press_keys(":");
    const shown = await panel.wait_open(": in a private window");
    expect(shown.private_id === 1 && shown.system === false, `the private window's panel runs as ${JSON.stringify(shown)}`);
    await press_keys("tab.");
    await panel.line_holds("tab.");
    await escape_until_closed();
    await close_private_windows();
  });

  await run_case("closing the tab under the panel closes it", async () => {
    await close_panel();
    await home("bmp_last");
    await open_tab("about:support");
    await focus_page();
    await press_keys(":");
    await panel.wait_open(": on about:support");
    await close_selected_tab();
    await closes("closing the tab");
  });
}
