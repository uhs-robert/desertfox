// The pane keys on the browser module (desertfox-panes.js): En opens a split with a new tab, EN splits with the next tab, Eu unsplits, E> and E< resize the left pane, E= makes the panes equal, Eh and El move between panes, E<Space> holds the group, ED and ES focus DevTools and the sidebar, and Ex closes both tabs.
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

  await run_case("Ex closes both tabs of the split view", async () => {
    await chrome(`(async () => { ${DEVTOOLS} for (const tab of ${W}.gBrowser.tabs) await gDevTools.closeToolboxForTab(tab); })()`);
    await select_page("p55_a");
    await press_keys("Ex");
    await poll_until("both pages to close", async () => (await tab_of("p55_a")) === null && (await tab_of("p55_b")) === null);
    expect((await module_status()).errors.length === 0, `the module logged: ${(await module_status()).errors.join("; ")}`);
  });
}
