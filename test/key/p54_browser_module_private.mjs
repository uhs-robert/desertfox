// The browser module in a private window: idle while DesertFox may not run in private windows, and active once it may, on about:privatebrowsing, about:newtab and about:home.
import { evaluate_in_chrome } from "./rdp.mjs";
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["tabs"];

const EXTENSION_ID = "desertfox@uhs-robert";
const PRIVATE_PAGES = ["about:privatebrowsing", "about:newtab", "about:home"];

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, on_teardown, rdp, sleep } = context;
  const steps = module_steps(context);
  const { chrome, focus_page, switches_one, switches_none, selected_spec } = steps;
  const private_access = () => chrome(`(async () => WebExtensionPolicy.getByID("${EXTENSION_ID}").privateBrowsingAllowed)()`);
  // The add-on manager's own switch for "Run in Private Windows", which also tells the running extension.
  const set_private_access = (allowed) =>
    chrome(`(async () => {
      const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
      const { extension } = WebExtensionPolicy.getByID("${EXTENSION_ID}");
      const change = { permissions: ["internal:privateBrowsingAllowed"], origins: [] };
      await (${allowed} ? ExtensionPermissions.add("${EXTENSION_ID}", change, extension) : ExtensionPermissions.remove("${EXTENSION_ID}", change, extension));
    })()`);

  // One private window with one tab per page, the first selected.
  async function open_private_window() {
    await chrome(`(async () => {
      const opener = Services.wm.getMostRecentWindow("navigator:browser");
      const w = opener.OpenBrowserWindow({ private: true });
      await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished"));
      for (const url of ${JSON.stringify(PRIVATE_PAGES.slice(1))}) w.gBrowser.addTrustedTab(url);
      w.gBrowser.selectedTab = w.gBrowser.tabs[0];
    })()`);
    on_teardown(close_private_windows);
    await poll_until("the private window to be the newest and show about:privatebrowsing", async () => (await chrome(`(async () => { const w = Services.wm.getMostRecentWindow("navigator:browser"); return w.gBrowser.tabs.length; })()`)) === PRIVATE_PAGES.length && (await selected_spec()) === "about:privatebrowsing", { timeout_ms: 10000 });
  }
  const close_private_windows = () => chrome(`(async () => { const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs"); for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (PrivateBrowsingUtils.isWindowPrivate(w)) w.close(); })()`);
  const select = (url) => chrome(`(async () => { const w = Services.wm.getMostRecentWindow("navigator:browser"); w.gBrowser.selectedTab = [...w.gBrowser.tabs].find((tab) => tab.linkedBrowser.currentURI.spec === ${JSON.stringify(url)}); })()`);

  await setup("turn the module on", () => steps.turn_on_module());
  const access_before = await private_access();
  on_teardown(() => set_private_access(access_before));

  await run_case("without private window access the module takes nothing in a private window", async () => {
    await set_private_access(false);
    await poll_until("DesertFox to lose private window access", async () => (await private_access()) === false);
    await open_private_window();
    for (const page of PRIVATE_PAGES) {
      await select(page);
      await focus_page();
      await switches_none(`J on ${page} in a private window without access`);
    }
    await close_private_windows();
  });

  await run_case("with private window access J switches exactly one tab on about:privatebrowsing, about:newtab and about:home", async () => {
    await set_private_access(true);
    await poll_until("DesertFox to gain private window access", async () => (await private_access()) === true);
    await open_private_window();
    for (const page of PRIVATE_PAGES) {
      await select(page);
      await focus_page();
      await switches_one(`J on ${page} in a private window`);
    }
    await close_private_windows();
    await sleep(200);
    expect((await evaluate_in_chrome(rdp, `(async () => Services.desertfox_browser_module.status().windows)()`)) >= 1, "the module lost the normal window");
  });
}
