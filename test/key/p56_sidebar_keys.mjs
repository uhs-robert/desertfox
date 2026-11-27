// The browser module's sidebar keys with real keys: j, k, Enter, d, / and Escape in the history and open tabs panels and in the vertical tab strip.
// The sidebar table is the one the extension builds from the default keymap's sidebar mode.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "tabs"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const STATE_KEY = "desertfox_browser_module_state";
// Names an element for a failure message and for comparing two focus reads.
const HELPERS = `
  const w = ${W};
  const name = (n) => n ? n.localName + (n.id ? "#" + n.id : "") + (n.dataset?.guid ? "@" + n.dataset.guid : "") + (n.getAttribute?.("aria-label") ? "[" + n.getAttribute("aria-label") + "]" : "") : null;
  const deep = (doc) => { let a = doc?.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, open_page, on_teardown } = context;
  const steps = module_steps(context);
  const { chrome, session_value, set_session_value, module_status } = steps;

  // The background writes the table with the state once the module is on.
  async function sidebar_table_ready() {
    await poll_until("the state to carry the sidebar table", async () => ((await session_value(STATE_KEY))?.sidebar_keys?.length ?? 0) === 10, { timeout_ms: 5000 });
  }

  const focus = () =>
    chrome(`(async () => { ${HELPERS}
      const doc = w.SidebarController.browser.contentDocument;
      const panel_focus = deep(doc);
      const input = panel_focus?.localName === "input" ? panel_focus : null;
      const page = w.document.activeElement === w.gBrowser.selectedBrowser;
      return { url: doc?.documentURI ?? null, panel: name(panel_focus), value: input?.value ?? null, window: name(w.document.commandDispatcher.focusedElement), page, in_panel: w.document.activeElement === w.SidebarController.browser };
    })()`);
  const show_panel = async (id) => {
    await chrome(`(async () => { const w = ${W}; w.focus(); await w.SidebarController.show(${JSON.stringify(id)}); })()`);
    await poll_until(`the ${id} search box to take the focus`, async () => (await focus()).value !== null, { timeout_ms: 5000 });
  };
  const hide_panel = () => chrome(`(async () => { const w = ${W}; if (w.SidebarController.isOpen) w.SidebarController.hide(); w.gBrowser.selectedBrowser.focus(); })()`);
  const clear_search = () => chrome(`(async () => { ${HELPERS} const input = deep(w.SidebarController.browser.contentDocument); if (input?.localName === "input") { input.value = ""; input.dispatchEvent(new w.Event("input", { bubbles: true, composed: true })); } })()`);
  const selected_page = () => chrome(`(async () => ${W}.gBrowser.selectedBrowser.currentURI.spec)()`);
  const tab_count = () => chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
  const debug = async () => JSON.stringify({ focus: await focus(), status: await module_status() });
  const explain = async (wait) => {
    try {
      await wait;
    } catch (error) {
      throw new Error(`${error.message}: ${await debug()}`);
    }
  };

  // Escape takes the focus from the search box to the panel's list, where j and k move it.
  async function into_list() {
    await clear_search();
    await press_keys("-k", "Escape");
    await explain(poll_until("Escape to move the focus from the search box to the list", async () => {
      const now = await focus();
      return now.value === null && now.panel !== null;
    }));
  }

  // Presses `key` and waits for the panel's focus to move off `from`.
  async function moves(key, from) {
    await press_keys(key);
    await explain(poll_until(`${key} to move the focus in the panel`, async () => (await focus()).panel !== from));
    return (await focus()).panel;
  }

  async function to_row(what) {
    let row = (await focus()).panel;
    for (let step = 0; step < 6 && !/row/.test(row ?? ""); step++) row = await moves("j", row);
    expect(/row/.test(row ?? ""), `j found no ${what} row: ${await debug()}`);
  }

  await setup("turn the module on, open two pages and set the sidebar table", async () => {
    await steps.turn_on_module();
    expect((await module_status()).features.includes("desertfox-sidebar.js"), `the sidebar feature is not loaded: ${JSON.stringify(await module_status())}`);
    await open_page("page", "p56_a", { new_tab: false });
    await open_page("page", "p56_b", { new_tab: true });
    on_teardown(hide_panel);
  });

  await run_case("in the history panel a typed j stays text, Escape moves to the list and / focuses the search box", async () => {
    await sidebar_table_ready();
    await show_panel("viewHistorySidebar");
    await press_keys("j");
    await poll_until("j to type into the search box", async () => (await focus()).value === "j");
    await into_list();
    await press_keys("/");
    await explain(poll_until("/ to focus the search box", async () => (await focus()).value !== null));
    await hide_panel();
  });

  await run_case("in the history panel j and k move, Enter opens a page and Escape goes back to the page", async () => {
    await sidebar_table_ready();
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; })()`);
    await show_panel("viewHistorySidebar");
    await into_list();
    const start = (await focus()).panel;
    const second = await moves("j", start);
    const back = await moves("k", second);
    expect(back === start, `k went to ${back}, not back to ${start}`);
    // A row of the page the tab already shows would load nothing new, so j goes on to a row of the other page.
    const row_url = () => chrome(`(async () => { ${HELPERS} return deep(w.SidebarController.browser.contentDocument)?.url ?? null; })()`);
    await to_row("history");
    const before = await selected_page();
    for (let step = 0; step < 6 && [null, before].includes(await row_url()); step++) await moves("j", (await focus()).panel);
    const target = await row_url();
    expect(target !== null && target !== before, `j found no history row of another page: ${await debug()}`);
    await press_keys("-k", "Return");
    await explain(poll_until("Enter to load the history row in the tab", async () => (await selected_page()) === target, { timeout_ms: 5000 }));
    await chrome(`(async () => { ${W}.SidebarController.browser.focus(); })()`);
    await press_keys("-k", "Escape");
    await explain(poll_until("Escape to give the focus back to the page", async () => (await focus()).page));
    await hide_panel();
  });

  await run_case("in the open tabs panel d closes the row's tab", async () => {
    await sidebar_table_ready();
    await open_page("page", "p56_close", { new_tab: true });
    await chrome(`(async () => { Services.prefs.setBoolPref("sidebar.openTabsPanel.enabled", true); })()`);
    on_teardown(() => chrome(`(async () => Services.prefs.clearUserPref("sidebar.openTabsPanel.enabled"))()`));
    const before = await tab_count();
    await show_panel("viewOpenTabsSidebar");
    await into_list();
    await to_row("open tabs");
    await press_keys("d");
    await explain(poll_until("d to close one tab", async () => (await tab_count()) === before - 1));
    await hide_panel();
  });

  await run_case("in the vertical tab strip j moves the strip's focus, Enter selects the tab and Escape goes back to the page", async () => {
    await sidebar_table_ready();
    await chrome(`(async () => { Services.prefs.setBoolPref("sidebar.verticalTabs", true); })()`);
    on_teardown(() => chrome(`(async () => Services.prefs.clearUserPref("sidebar.verticalTabs"))()`));
    await poll_until("the strip to turn vertical", () => chrome(`(async () => ${W}.gBrowser.tabContainer.verticalMode === true)()`));
    const strip = () =>
      chrome(`(async () => { ${HELPERS} const strip = w.gBrowser.tabContainer; return { focused: strip.ariaFocusableItems.indexOf(strip.ariaFocusedItem), selected: strip.ariaFocusableItems.indexOf(w.gBrowser.selectedTab), count: strip.ariaFocusableItems.length, window: name(w.document.commandDispatcher.focusedElement) }; })()`);
    const strip_wait = async (wait) => {
      try {
        await wait;
      } catch (error) {
        throw new Error(`${error.message}: ${JSON.stringify(await strip())} ${await debug()}`);
      }
    };
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; await new Promise((resolve) => setTimeout(resolve, 200)); w.gBrowser.selectedTab.focus(); })()`);
    await strip_wait(poll_until("a tab to take the focus", async () => /^tab/.test((await strip()).window ?? "")));
    const start = await strip();
    expect(start.count >= 2, `the strip has ${start.count} items`);
    await press_keys("j");
    await strip_wait(poll_until("j to move the strip's focus to the next tab", async () => (await strip()).focused === start.selected + 1));
    await press_keys("-k", "Return");
    await strip_wait(poll_until("Enter to select that tab", async () => (await strip()).selected === start.selected + 1));
    await chrome(`(async () => { ${W}.gBrowser.selectedTab.focus(); })()`);
    await strip_wait(poll_until("the selected tab to take the focus", async () => /^tab/.test((await strip()).window ?? "")));
    await press_keys("-k", "Escape");
    await strip_wait(poll_until("Escape to give the focus back to the page", async () => (await focus()).page));
  });

  await run_case("with no sidebar table Escape leaves the focus in the panel's search box", async () => {
    const state = await session_value(STATE_KEY);
    await set_session_value(STATE_KEY, { ...state, sidebar_keys: undefined });
    await show_panel("viewHistorySidebar");
    await press_keys("-k", "Escape");
    await sleep(300);
    const now = await focus();
    expect(now.value !== null, `Escape left the search box with no sidebar table: ${JSON.stringify(now)}`);
    await hide_panel();
  });
}
