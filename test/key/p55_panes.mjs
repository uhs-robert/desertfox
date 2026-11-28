// The pane keys on the browser module (desertfox-panes.js): En opens a split with a new tab, EN splits with the next tab, Eu unsplits, E> and E< resize the left pane, E= makes the panes equal, Eh and El move between panes, EH and EL swap the panes, E<Space> holds the group, ED and ES focus DevTools and the sidebar, and Ex closes both tabs.
// Each key runs in the extension, which sends the request to the module, so every case also crosses the from-extension and from-module lists in a real Firefox.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["tabs", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const DEVTOOLS = `const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs"); const { gDevTools } = require("devtools/client/framework/devtools");`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, open_page, settle_focus, on_teardown } = context;
  const steps = module_steps(context);
  const { chrome, module_status } = steps;

  // The tab that shows the test page `id`, as its index in the strip, its split view id (0 for none) and whether it is selected.
  const tab_of = (id) =>
    chrome(`(async () => { const g = ${W}.gBrowser; const tab = g.tabs.find((t) => t.linkedBrowser.currentURI.spec.includes(${JSON.stringify(`id=${id}`)})); return tab ? { index: tab._tPos, split: tab.splitview?.splitViewId ?? 0, selected: tab.selected } : null; })()`);
  const select_page = async (id) => {
    await chrome(`(async () => { const g = ${W}.gBrowser; g.selectedTab = g.tabs.find((t) => t.linkedBrowser.currentURI.spec.includes(${JSON.stringify(`id=${id}`)})); })()`);
    await settle_focus();
  };
  const split_count = () => chrome(`(async () => ${W}.gBrowser.splitViews.length)()`);
  // The first panel's width and the panel area, in CSS pixels, with the first panel's min-width.
  const widths = () =>
    chrome(`(async () => { const w = ${W}; const panels = w.gBrowser.tabpanels; const first = w.document.getElementById(panels.splitViewPanels[0]); return { first: first.getBoundingClientRect().width, area: panels.clientWidth, min: parseFloat(w.getComputedStyle(first).minWidth) || 0 }; })()`);
  // The module answers each request on its own list, so a refusal shows there even though the extension only shows it as a message.
  const last_reply = async () => ((await steps.session_value("desertfox_browser_module_from_module")) ?? []).at(-1) ?? null;

  await setup("turn the module on and open two test pages", async () => {
    await steps.turn_on_module();
    expect((await module_status()).features.includes("desertfox-panes.js"), `the pane feature is not loaded: ${JSON.stringify(await module_status())}`);
    await open_page("page", "p55_a", { new_tab: true });
    await open_page("page", "p55_b", { new_tab: true });
    await select_page("p55_a");
  });

  await run_case("En splits the tab with a new open tabs picker, and Eu from the page unsplits and drops the picker", async () => {
    const before = await split_count();
    await press_keys("En");
    await poll_until("a split view with the open tabs picker selected", async () => (await split_count()) === before + 1 && (await steps.selected_spec()) === "about:opentabs");
    const split = (await tab_of("p55_a")).split;
    expect(split > 0, "the page is not in the new split view");
    await select_page("p55_a");
    await press_keys("Eu");
    await poll_until("the split view to end", async () => (await split_count()) === before && (await tab_of("p55_a")).split === 0);
    expect((await chrome(`(async () => ${W}.gBrowser.tabs.some((t) => t.linkedBrowser.currentURI.spec === "about:opentabs"))()`)) === false, "the open tabs picker stayed after Eu");
  });

  await run_case("Eu on a tab that is not in a split view is refused with the module's reason", async () => {
    await select_page("p55_a");
    await press_keys("Eu");
    await poll_until("the module's refusal", async () => (await last_reply())?.error === "This tab is not in a split view");
  });

  await run_case("El with no split view and nothing docked on the right is refused, as the sidebar sits on the left", async () => {
    await select_page("p55_a");
    await press_keys("El");
    await poll_until("the module's refusal", async () => (await last_reply())?.error === "Nothing to focus on the right");
  });

  await run_case("EN splits the tab with the tab after it", async () => {
    await select_page("p55_a");
    await press_keys("EN");
    await poll_until("the two pages to share a split view", async () => {
      const [a, b] = [await tab_of("p55_a"), await tab_of("p55_b")];
      return a.split > 0 && a.split === b.split;
    });
    // The resize, focus and close cases act on this split.
  }, { setup: true });

  await run_case("E> widens the left pane by 5 percent of the panel area, E< narrows it back, and a long widen stops at the other pane's min-width", async () => {
    await select_page("p55_a");
    const start = await widths();
    await press_keys("E>");
    await poll_until("the left pane to widen one step", async () => Math.abs((await widths()).first - (start.first + 0.05 * start.area)) <= 2);
    await press_keys("E<");
    await poll_until("the left pane to come back", async () => Math.abs((await widths()).first - start.first) <= 2);
    await press_keys("20E>");
    await poll_until("the left pane to stop at the limit", async () => Math.abs((await widths()).first - (start.area - start.min)) <= 2);
  });

  await run_case("E= gives the two panes equal widths after a resize", async () => {
    await select_page("p55_a");
    const second_width = () => chrome(`(async () => { const w = ${W}; return w.document.getElementById(w.gBrowser.tabpanels.splitViewPanels[1]).getBoundingClientRect().width; })()`);
    const start = await widths();
    // The case before leaves the left pane at its widest, so this one narrows it.
    await press_keys("E<");
    await poll_until("the left pane to narrow", async () => (await widths()).first < start.first - 10);
    await press_keys("E=");
    await poll_until("the panes to have equal widths", async () => Math.abs((await widths()).first - (await second_width())) <= 2);
  });

  await run_case("E<Space> holds the Pane group, so <<< narrows the left pane three steps", async () => {
    await select_page("p55_a");
    const start = await widths();
    on_teardown(() => press_keys("-k", "Escape"));
    await press_keys("E", " ");
    for (let step = 1; step <= 3; step++) {
      await press_keys("<");
      await poll_until(`the left pane to narrow ${step} steps`, async () => Math.abs((await widths()).first - (start.first - step * 0.05 * start.area)) <= 2 * step);
    }
    await press_keys("-k", "Escape");
  });

  await run_case("Eh and El move the focus between the split panes", async () => {
    await select_page("p55_a");
    await press_keys("El");
    await poll_until("the right pane to be selected", async () => (await tab_of("p55_b"))?.selected === true);
    await settle_focus();
    await press_keys("Eh");
    await poll_until("the left pane to be selected", async () => (await tab_of("p55_a"))?.selected === true);
  });

  // Where the page `id` shows, by its panel's left edge, and whether its <browser> holds the window's focus.
  const pane_of = (id) =>
    chrome(`(async () => { const w = ${W}; const tab = w.gBrowser.tabs.find((t) => t.linkedBrowser.currentURI.spec.includes(${JSON.stringify(`id=${id}`)})); return { left: w.document.getElementById(tab.linkedPanel).getBoundingClientRect().left, selected: tab.selected, focused: w.document.commandDispatcher.focusedElement === tab.linkedBrowser }; })()`);
  const a_is_right = async () => (await pane_of("p55_a")).left > (await pane_of("p55_b")).left;

  await run_case("EL and EH swap the split panes, keep the moved pane selected and focused, and refuse the side it is on", async () => {
    await select_page("p55_a");
    expect(!(await a_is_right()), "the first page does not start on the left");
    const reply_before = (await last_reply())?.reply_to;
    await press_keys("EL");
    await poll_until("the module to answer EL with ok", async () => {
      const reply = await last_reply();
      return reply?.reply_to !== reply_before && reply?.ok === true;
    });
    await poll_until("the first page to show on the right", a_is_right);
    await poll_until("the moved pane to keep the selection and the focus", async () => {
      const a = await pane_of("p55_a");
      return a.selected && a.focused;
    });
    await settle_focus();
    await press_keys("EL");
    await poll_until("the module's refusal", async () => (await last_reply())?.error === "This pane is already on the right");
    await press_keys("EH");
    await poll_until("the first page to show on the left again", async () => !(await a_is_right()));
    expect((await pane_of("p55_a")).focused, "the focus left the moved pane after EH");
  });

  await run_case("E<Space> holds the Pane group, so LH swaps the panes there and back", async () => {
    await select_page("p55_a");
    on_teardown(() => press_keys("-k", "Escape"));
    await press_keys("E", " ");
    await press_keys("L");
    await poll_until("the first page to show on the right", a_is_right);
    await press_keys("H");
    await poll_until("the first page to show on the left again", async () => !(await a_is_right()));
    await press_keys("-k", "Escape");
  });

  await run_case("ED puts the focus in the docked toolbox", async () => {
    await select_page("p55_a");
    on_teardown(() => chrome(`(async () => { ${DEVTOOLS} for (const tab of ${W}.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); })()`));
    // The first toolbox takes longer than one debugger call may run, so the call starts it and the case waits for it.
    await chrome(`(async () => { ${DEVTOOLS} void gDevTools.showToolboxForTab(${W}.gBrowser.selectedTab, { toolId: "webconsole", hostType: "bottom" }); })()`);
    await poll_until("the docked console to open", () => chrome(`(async () => { ${DEVTOOLS} const toolbox = gDevTools.getToolboxForTab(${W}.gBrowser.selectedTab); return toolbox?.hostType === "bottom" && !!toolbox.getPanel("webconsole"); })()`), { timeout_ms: 15000 });
    // A new toolbox takes the focus, and the key goes to the page.
    await chrome(`(async () => ${W}.gBrowser.selectedBrowser.focus())()`);
    await settle_focus();
    const focused = () => chrome(`(async () => String(${W}.document.commandDispatcher.focusedWindow?.location?.href ?? ""))()`);
    expect(!/devtools/.test(await focused()), `the focus is in DevTools before ED: ${await focused()}`);
    await press_keys("ED");
    await poll_until("the focus to move into DevTools", async () => /devtools/.test(await focused()));
  });

  await run_case("ES opens the closed sidebar and puts the focus in it", async () => {
    const sidebar_open = () => chrome(`(async () => ${W}.SidebarController.isOpen)()`);
    on_teardown(() => chrome(`(async () => { const w = ${W}; if (w.SidebarController.isOpen) w.SidebarController.hide(); })()`));
    await chrome(`(async () => { ${DEVTOOLS} for (const tab of ${W}.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); const w = ${W}; if (w.SidebarController.isOpen) w.SidebarController.hide(); })()`);
    await poll_until("the sidebar to be closed", async () => (await sidebar_open()) === false);
    await select_page("p55_a");
    await press_keys("ES");
    const focus_in_sidebar = () => chrome(`(async () => { const w = ${W}; const active = w.document.activeElement; return !!active && !!w.document.getElementById("sidebar")?.contains(active); })()`);
    await poll_until("the sidebar to open with the focus in it", async () => (await sidebar_open()) && (await focus_in_sidebar()));
    // The sidebar runs no content script and the module takes single keys only, so no E key reaches DesertFox from there. The next case needs the page focused.
    await chrome(`(async () => { const w = ${W}; w.SidebarController.hide(); w.gBrowser.selectedBrowser.focus(); })()`);
  });

  await run_case("ES with vertical tabs and no panel puts the DOM focus on the strip, and j then moves the strip's focus", async () => {
    await chrome(`(async () => { Services.prefs.setBoolPref("sidebar.verticalTabs", true); })()`);
    on_teardown(() => chrome(`(async () => { Services.prefs.clearUserPref("sidebar.verticalTabs"); const w = ${W}; if (w.SidebarController.isOpen) w.SidebarController.hide(); w.gBrowser.selectedBrowser.focus(); })()`));
    await poll_until("the strip to turn vertical", () => chrome(`(async () => ${W}.gBrowser.tabContainer.verticalMode === true)()`));
    await chrome(`(async () => { const w = ${W}; if (w.SidebarController.isOpen) w.SidebarController.hide(); })()`);
    await poll_until("the sidebar panel to be closed and the launcher to show", () => chrome(`(async () => { const s = ${W}.SidebarController; return !s.isOpen && s.launcherVisible === true; })()`));
    await select_page("p55_a");
    const strip = () =>
      chrome(`(async () => { const w = ${W}; const c = w.gBrowser.tabContainer; const items = c.ariaFocusableItems; const active = w.document.commandDispatcher.focusedElement; return { focused: items.indexOf(c.ariaFocusedItem), selected: items.indexOf(w.gBrowser.selectedTab), count: items.length, dom_in_strip: !!active?.closest?.("#tabbrowser-tabs"), panel_open: w.SidebarController.isOpen }; })()`);
    expect((await strip()).dom_in_strip === false, `the DOM focus starts in the strip: ${JSON.stringify(await strip())}`);
    await press_keys("ES");
    await poll_until("the DOM focus to land on the strip with no panel open", async () => {
      const now = await strip();
      return now.dom_in_strip && !now.panel_open;
    });
    const start = await strip();
    expect(start.count >= 2 && start.focused === start.selected, `the strip focus is not on the selected tab: ${JSON.stringify(start)}`);
    await press_keys("j");
    await poll_until("j to move the strip's focus to the next item", async () => (await strip()).focused === start.selected + 1);
    await press_keys("-k", "Escape");
  });

  await run_case("Ex closes both tabs of the split view", async () => {
    await chrome(`(async () => { ${DEVTOOLS} for (const tab of ${W}.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); })()`);
    await select_page("p55_a");
    await press_keys("Ex");
    await poll_until("both pages to close", async () => (await tab_of("p55_a")) === null && (await tab_of("p55_b")) === null);
    expect((await module_status()).errors.length === 0, `the module logged: ${(await module_status()).errors.join("; ")}`);
  });
}
