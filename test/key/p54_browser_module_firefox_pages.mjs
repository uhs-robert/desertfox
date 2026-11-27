// :firefox and the ,f keys through the browser module (desertfox-firefox-pages.js), with the native host taken away, so every open here is the module's.
// The module opens the page in the asking tab's window, switches to a tab that already shows it, and replaces the tab for where=here.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["help", "keys", "tabs"];

const EXTENSION_ID = "desertfox@uhs-robert";
const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
// The module opens nothing more for the same page in the same window within a second, and at most 5 pages in 10 s.
const SAME_OPEN_MS = 1000;
const RATE_WINDOW_MS = 10000;
const MAX_OPENS = 5;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, open_page, settle_focus, run_line, on_teardown, sleep, set_optional_permissions, in_background, url_of, events, wait_event } = context;
  const steps = module_steps(context);
  const { chrome, selected_spec, in_selected_page } = steps;

  // The tabs of the most recent window whose address starts with `prefix`.
  const tabs_at = (prefix) => chrome(`(async () => ${W}.gBrowser.tabs.filter((tab) => tab.linkedBrowser.currentURI.spec.startsWith(${JSON.stringify(prefix)})).length)()`);
  const tab_count = () => chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
  const window_count = () => chrome(`(async () => [...Services.wm.getEnumerator("navigator:browser")].length)()`);
  const close_tabs_at = (...prefixes) =>
    chrome(`(async () => { for (const w of Services.wm.getEnumerator("navigator:browser")) for (const tab of [...w.gBrowser.tabs]) if (${JSON.stringify(prefixes)}.some((prefix) => tab.linkedBrowser.currentURI.spec.startsWith(prefix)) && w.gBrowser.tabs.length > 1) w.gBrowser.removeTab(tab); })()`);
  const select_page = async (id) => {
    await chrome(`(async () => { const g = ${W}.gBrowser; g.selectedTab = g.tabs.find((t) => t.linkedBrowser.currentURI.spec.includes(${JSON.stringify(`id=${id}`)})); })()`);
    await settle_focus();
  };
  const last_reply = async () => ((await steps.session_value("desertfox_browser_module_from_module")) ?? []).at(-1) ?? null;
  // Each open waits until the module's rate limit would take it, so a fast run never hits the limit.
  let opened_at = [];
  async function pace() {
    opened_at = opened_at.filter((at) => Date.now() - at < RATE_WINDOW_MS + 500);
    if (opened_at.length >= MAX_OPENS) await sleep(RATE_WINDOW_MS + 500 - (Date.now() - opened_at[0]));
    opened_at.push(Date.now());
  }
  const clipboard = () => in_background(`navigator.clipboard.readText()`);
  // A page DesertFox runs on, opened by the background with extra tab properties (a container, a private window), and ready for keys.
  async function open_test_page(id, create) {
    const mark = events.length;
    const tab_id = await in_background(create(JSON.stringify(url_of("page", id))));
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 8000);
    await settle_focus({ tab_id, keys_page_id: id });
    return tab_id;
  }

  await setup("turn the module on and take the native host away", async () => {
    await steps.turn_on_module();
    expect((await steps.module_status()).features.includes("desertfox-firefox-pages.js"), `the Firefox pages feature is not loaded: ${JSON.stringify(await steps.module_status())}`);
    expect((await steps.session_value("desertfox_browser_module_hello"))?.firefox_pages === true, "the hello does not say firefox_pages");
    on_teardown(() => set_optional_permissions("grant", ["nativeMessaging"]));
    await set_optional_permissions("remove", ["nativeMessaging"]);
    await in_background(`navigator.clipboard.writeText("before")`);
  });

  await run_case(",fs opens about:preferences as the selected tab of the same window, and a second ,fs switches to it", async () => {
    on_teardown(() => close_tabs_at("about:preferences", "about:settings"));
    await open_page("page", "fpm_settings", { new_tab: true });
    const [windows_before, tabs_before] = [await window_count(), await tab_count()];
    await pace();
    await press_keys(",fs");
    await poll_until("about:preferences to be the selected tab", async () => (await selected_spec()) === "about:preferences", { timeout_ms: 8000 });
    expect((await window_count()) === windows_before && (await tab_count()) === tabs_before + 1, "the module did not add exactly one tab in this window");
    expect((await clipboard()) === "before", "the clipboard route ran beside the module");
    await sleep(SAME_OPEN_MS + 100);
    await select_page("fpm_settings");
    await pace();
    await press_keys(",fs");
    await poll_until("the open settings tab to be selected again", async () => (await selected_spec()) === "about:preferences", { timeout_ms: 8000 });
    expect((await tabs_at("about:preferences")) === 1, `a second settings tab opened: ${await tabs_at("about:preferences")}`);
  });

  await run_case(":open about:addons on a web page opens the Add-ons page through the module", async () => {
    on_teardown(() => close_tabs_at("about:addons"));
    await open_page("page", "fpm_open_addons", { new_tab: true });
    await pace();
    await run_line(":open about:addons");
    await poll_until("about:addons to be the selected tab", async () => (await selected_spec()) === "about:addons", { timeout_ms: 8000 });
    // Later cases count add-ons tabs, so this one leaves none behind.
    await close_tabs_at("about:addons");
  });

  await run_case(":firefox settings-privacy lands on the privacy section", async () => {
    on_teardown(() => close_tabs_at("about:preferences", "about:settings"));
    await open_page("page", "fpm_pane", { new_tab: true });
    await pace();
    await run_line(":firefox settings-privacy");
    await poll_until("about:preferences#privacy to be the selected tab", async () => (await selected_spec()) === "about:preferences#privacy", { timeout_ms: 8000 });
    await poll_until("the privacy section to show", () => in_selected_page(`(win) => (win.gLastCategory ?? win.wrappedJSObject?.gLastCategory)?.category === "panePrivacy"`), { timeout_ms: 8000 });
  });

  await run_case(":firefox config shows Firefox's warning page and changes no pref", async () => {
    on_teardown(() => chrome(`(async () => Services.prefs.clearUserPref("browser.aboutConfig.showWarning"))()`));
    on_teardown(() => close_tabs_at("about:config"));
    await chrome(`(async () => Services.prefs.setBoolPref("browser.aboutConfig.showWarning", true))()`);
    await open_page("page", "fpm_config", { new_tab: true });
    await pace();
    await run_line(":firefox config");
    await poll_until("about:config to be the selected tab", async () => (await selected_spec()) === "about:config", { timeout_ms: 8000 });
    await poll_until("the warning to show", () => in_selected_page(`(win) => !!win.document.getElementById("warningButton")?.checkVisibility()`), { timeout_ms: 8000 });
    expect((await chrome(`(async () => Services.prefs.getBoolPref("browser.aboutConfig.showWarning"))()`)) === true, "the open changed the warning pref");
  });

  await run_case(":firefox --where=here addons replaces the current tab, and :firefox addons-shortcuts opens the shortcuts view", async () => {
    on_teardown(() => close_tabs_at("about:addons"));
    await open_page("page", "fpm_here", { new_tab: true });
    const tabs_before = await tab_count();
    await pace();
    await run_line(":firefox --where=here addons");
    await poll_until("about:addons in the same tab", async () => (await selected_spec()) === "about:addons", { timeout_ms: 8000 });
    expect((await tab_count()) === tabs_before, "where=here added a tab");
    await open_page("page", "fpm_shortcuts", { new_tab: true });
    await pace();
    await run_line(":firefox addons-shortcuts");
    await poll_until("the shortcuts view in the open add-ons tab", () => in_selected_page(`(win) => win.gViewController?.currentViewId === "addons://shortcuts/shortcuts"`), { timeout_ms: 8000 });
    expect((await tabs_at("about:addons")) === 1, "the shortcuts view opened a second add-ons tab");
  });

  await run_case("here on a tab the user left is refused by the module and the host is not asked", async () => {
    await open_page("page", "fpm_stale", { new_tab: true });
    const tab_id = await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.id)`);
    // The background sends the request for a tab that is no longer selected, as a late key would.
    await open_page("page", "fpm_other", { new_tab: true });
    await chrome(`(async () => {
      const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
      const { ExtensionStorage, extensionStorageSession } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorage.sys.mjs");
      const extension = ExtensionParent.GlobalManager.getExtension("${EXTENSION_ID}");
      const key = "desertfox_browser_module_from_extension";
      extensionStorageSession.set(extension, { [key]: ExtensionStorage.serialize(key, key, [{ v: 1, id: "fpm-stale", kind: "firefox_page.open", args: { page: "memory", where: "here", tab_id: ${tab_id} }, sent_at: Date.now() }]) });
    })()`);
    await poll_until("the module's refusal", async () => (await last_reply())?.error === "The tab that asked is no longer selected", { timeout_ms: 5000 });
    expect((await tabs_at("about:memory")) === 0, "a stale here opened the page");
  });

  await run_case("from a container tab the page opens with no container", async () => {
    on_teardown(() => close_tabs_at("about:downloads"));
    await open_test_page("fpm_container", (url) => `browser.tabs.create({ url: ${url}, cookieStoreId: "firefox-container-1", active: true }).then((tab) => tab.id)`);
    expect((await chrome(`(async () => ${W}.gBrowser.selectedTab.getAttribute("usercontextid"))()`)) === "1", "the test page is not in a container");
    await pace();
    await press_keys(",fd");
    await poll_until("about:downloads to be the selected tab", async () => (await selected_spec()) === "about:downloads", { timeout_ms: 8000 });
    const container = await chrome(`(async () => ${W}.gBrowser.selectedTab.getAttribute("usercontextid"))()`);
    expect(container === null || container === "" || container === "0", `about:downloads opened in container ${container}`);
  });

  await run_case("in a private window with private window access the page opens in that private window", async () => {
    const private_access = () => chrome(`(async () => WebExtensionPolicy.getByID("${EXTENSION_ID}").privateBrowsingAllowed)()`);
    const set_private_access = (allowed) =>
      chrome(`(async () => {
        const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
        const { extension } = WebExtensionPolicy.getByID("${EXTENSION_ID}");
        const change = { permissions: ["internal:privateBrowsingAllowed"], origins: [] };
        await (${allowed} ? ExtensionPermissions.add("${EXTENSION_ID}", change, extension) : ExtensionPermissions.remove("${EXTENSION_ID}", change, extension));
      })()`);
    const access_before = await private_access();
    on_teardown(() => set_private_access(access_before));
    on_teardown(() => chrome(`(async () => { const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs"); for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (PrivateBrowsingUtils.isWindowPrivate(w)) w.close(); })()`));
    await set_private_access(true);
    await poll_until("DesertFox to gain private window access", async () => (await private_access()) === true);
    await open_test_page("fpm_private", (url) => `browser.windows.create({ url: ${url}, incognito: true }).then((win) => win.tabs[0].id)`);
    const windows_before = await window_count();
    await pace();
    await press_keys(",fd");
    const private_selected = `(async () => { const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs"); const w = ${W}; return PrivateBrowsingUtils.isWindowPrivate(w) ? w.gBrowser.selectedBrowser.currentURI.spec : null; })()`;
    await poll_until("about:downloads in the private window", async () => (await chrome(private_selected)) === "about:downloads", { timeout_ms: 8000 });
    expect((await window_count()) === windows_before, "the open made another window");
  });
}
