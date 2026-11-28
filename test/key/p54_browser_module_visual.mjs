// Caret and visual mode on a parent-process about: page through the browser module: v shows CARET and turns caret browsing on, V shows VISUAL and selects, Escape gives the user's pref back, and a tab switch does too.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["ui", "keys"];

const CARET_PREF = "accessibility.browsewithcaret";
const W = `Services.wm.getMostRecentWindow("navigator:browser")`;

export async function run_cases(context) {
  const { run_case, setup, poll_until, press_keys, on_teardown, run_line } = context;
  const steps = module_steps(context);
  const { chrome, open_tab, focus_page, close_selected_tab, in_selected_page } = steps;

  const bar_mode = () => chrome(`(async () => ${W}.document.getElementById("desertfox-statusbar")?.querySelector(".dfx-left")?.firstElementChild?.textContent ?? null)()`);
  const mode_is = (label) => async () => (await bar_mode()) === label;
  const caret_pref = () => chrome(`(async () => Services.prefs.getBoolPref("${CARET_PREF}", false))()`);

  await setup("turn the module on and the bar", async () => {
    await steps.turn_on_module();
    await run_line(":set browser_bar true");
    on_teardown(() => run_line(":unset browser_bar"));
  });

  await run_case("v on about:preferences shows CARET with caret browsing on, and Escape gives the pref back", async () => {
    await open_tab("about:preferences");
    await focus_page();
    // The search box takes the focus as the page opens, so the focus goes to the page body first.
    await chrome(`(async () => { ${W}.gBrowser.selectedBrowser.focus(); ${W}.gBrowser.selectedBrowser.contentDocument?.activeElement?.blur?.(); })()`);
    await press_keys("v");
    await poll_until("CARET in the bar", mode_is("CARET"), { timeout_ms: 8000 });
    await poll_until("caret browsing on", caret_pref);
    await press_keys("Escape");
    await poll_until("NORMAL in the bar", mode_is("NORMAL"), { timeout_ms: 8000 });
    await poll_until("caret browsing back to the user's value", async () => !(await caret_pref()));
    await close_selected_tab();
  });

  await run_case("V on about:support shows VISUAL with a selection, and a tab switch ends it and gives the pref back", async () => {
    await open_tab("about:support");
    await focus_page();
    await press_keys("V");
    await poll_until("VISUAL in the bar", mode_is("VISUAL"), { timeout_ms: 8000 });
    await poll_until("a selection in the page", () => in_selected_page(`(win) => win.getSelection().toString().length > 0`));
    await chrome(`(async () => { const g = ${W}.gBrowser; g.selectedTab = g.tabs.find((tab) => tab !== g.selectedTab); })()`);
    await poll_until("the pref back", async () => !(await caret_pref()));
    await chrome(`(async () => { const g = ${W}.gBrowser; g.selectedTab = g.tabs.find((tab) => tab.linkedBrowser.currentURI.spec === "about:support"); })()`);
    await poll_until("NORMAL in the bar", mode_is("NORMAL"), { timeout_ms: 8000 });
    await close_selected_tab();
  });
}
