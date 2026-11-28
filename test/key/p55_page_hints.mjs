// Hints on Firefox's own pages in the parent process (browser_module/desertfox-chrome-hints.js, the page place): f on about:preferences labels its controls in the window's layer and a label picks, the bar says HINT meanwhile,
// a pick of the search box leaves the bar in INSERT and Escape then blurs it, F on a link opens a background tab, a grant on about:addons and a pref write on about:config wait for Enter, and the allowlist's pages run in the parent process.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["hints", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const SESSION_KEY = "desertfox_chrome_hints";
const TEST_PREF = "desertfox.key_test.page_hints_flag";
const SORT_PREF = "browser.ctrlTab.sortByRecentlyUsed";
// LABELS_SEEN_MS of the module, with a margin.
const LABELS_SEEN_MS = 400;

// Chrome code: the first element of the selected tab's page that matches `selector`, through the shadow roots, as `find(el)`.
const DEEP_FIND = `const deep_find = (root, selector) => { const hit = root.querySelector(selector); if (hit) return hit; for (const el of root.querySelectorAll("*")) { const shadow = el.openOrClosedShadowRoot; const inner = shadow && deep_find(shadow, selector); if (inner) return inner; } return null; };`;
// Chrome code: the label on the element `pick(doc, deep_find)` gives, matched by its top left corner in the window's pixels, or null.
const label_on = (pick) => `(async () => {
  ${DEEP_FIND}
  const w = ${W};
  const b = w.gBrowser.selectedBrowser;
  const el = (${pick})(b.contentDocument, deep_find);
  if (!el) return null;
  // Firefox's own answer for where the element sits in the window, so the module's zoom math is not checked against itself.
  const quad = el.getBoxQuads({ relativeTo: w.document })[0].getBounds();
  const x = Math.max(0, Math.round(quad.left)), y = Math.max(0, Math.round(quad.top));
  let best = null, best_distance = Infinity;
  for (const host of w.document.querySelectorAll(".desertfox-page-hints")) for (const node of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
    const box = node.getBoundingClientRect();
    const distance = Math.abs(box.left - x) + Math.abs(box.top - y);
    if (distance < best_distance) [best, best_distance] = [node.textContent, distance];
  }
  return best_distance <= 3 ? best : null;
})()`;
const label_count = `(async () => [...${W}.document.querySelectorAll(".desertfox-page-hints")].reduce((sum, host) => sum + host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint").length, 0))()`;
const page_layers = `(async () => ${W}.document.querySelectorAll(".desertfox-page-hints").length)()`;
const confirm_shown = `(async () => [...${W}.document.querySelectorAll(".desertfox-page-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`;
const held_by = `(async () => Services.desertfox_browser_module.keys_held_by(${W}) ?? null)()`;
const in_field = `(async () => ${W}.windowUtils.IMEStatus === Components.interfaces.nsIDOMWindowUtils.IME_STATUS_ENABLED)()`;

// Chrome code: the clipboard's text.
const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;
// Page code: the links in the first screen of the page, in shadow roots too, in document order.
const VISIBLE_LINKS = `(doc, deep_find) => { const all = []; const walk = (root) => { for (const el of root.querySelectorAll("a[href]")) all.push(el); for (const el of root.querySelectorAll("*")) if (el.openOrClosedShadowRoot) walk(el.openOrClosedShadowRoot); }; walk(doc); return all.filter((a) => a.checkVisibility() && a.getBoundingClientRect().width > 4 && a.getBoundingClientRect().top >= 0 && a.getBoundingClientRect().bottom <= doc.defaultView.innerHeight); }`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, take_shot, run_line, on_teardown, in_background, clear_notices } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, focus_page, close_selected_tab, home, in_selected_page } = steps;
  const bar_mode = () => chrome(`(async () => { const bar = ${W}.document.getElementById("desertfox-statusbar"); return bar?.hasAttribute("data-on") ? bar.querySelector(".dfx-left")?.children[0]?.textContent ?? null : null; })()`);
  const notices = async () => Object.values((await in_background(`browser.notifications.getAll()`)) ?? {}).map((notice) => notice.message);
  const tab_case = (name, body) =>
    run_case(name, async () => {
      try {
        await body();
      } finally {
        await press_keys("-k", "Escape");
        await close_selected_tab();
      }
    });
  async function start_hints(key, what) {
    await press_keys(key);
    await poll_until(`${what}: the labels to show`, async () => (await chrome(label_count)) > 0, { timeout_ms: 5000 });
    // The module counts a key toward a label only from 300 ms after the labels show, so a key typed sooner spells nothing.
    await sleep(LABELS_SEEN_MS);
  }
  async function expect_ended(what) {
    await poll_until(`${what}: the layer to go`, async () => (await chrome(page_layers)) === 0, { timeout_ms: 3000 });
    await poll_until(`${what}: the hold to go`, async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
    await poll_until(`${what}: the extension to drop its session`, async () => (await session_value(SESSION_KEY)) === null, { timeout_ms: 3000 });
  }
  async function open_page(url, ready) {
    await open_tab(url);
    await poll_until(`${url} to load`, () => in_selected_page(ready), { timeout_ms: 10000 });
    await focus_page();
  }
  const scroll_to = (selector) => in_selected_page(`(win) => { ${DEEP_FIND} const el = deep_find(win.document, ${JSON.stringify(selector)}); el?.scrollIntoView({ block: "center" }); return !!el; }`);

  await setup("turn the module on, with the bar", async () => {
    await steps.turn_on_module();
    on_teardown(() => run_line(":unset browser_bar"));
    await run_line(":set browser_bar true");
    await poll_until("the state to say the extension answers page hints", async () => (await session_value("desertfox_browser_module_state"))?.page_hints === true, { timeout_ms: 5000 });
    await poll_until("the hello to say the module runs page hints", async () => (await session_value("desertfox_browser_module_hello"))?.page_hints === true, { timeout_ms: 5000 });
  });

  await run_case("the allowlist's pages run in the parent process, and the pages that keep the notice in a content process are not labelled", async () => {
    await home("ph_process");
    const where = {};
    for (const url of ["about:preferences", "about:settings", "about:addons", "about:downloads", "about:config", "about:protections", "about:logins", "about:newtab", "about:support"]) {
      await open_tab(url);
      await sleep(300);
      where[url] = await chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; return { remote: b.isRemoteBrowser, type: b.remoteType ?? null, labelled: Services.desertfox_browser_module.page_hints()?.handles(b) ?? false }; })()`);
      await close_selected_tab();
    }
    console.log(`page processes: ${JSON.stringify(where)}`);
    for (const url of ["about:preferences", "about:settings", "about:addons", "about:downloads", "about:config"]) expect(where[url].remote === false && where[url].labelled === true, `${url} is not a labelled parent-process page: ${JSON.stringify(where[url])}`);
    for (const url of ["about:protections", "about:logins", "about:newtab", "about:support"]) expect(where[url].labelled === false, `${url} got page hints: ${JSON.stringify(where[url])}`);
  });

  await tab_case("on about:preferences f labels the page in the window's layer, the bar says HINT, a label picks a section and then a checkbox in it", async () => {
    await home("ph_prefs");
    on_teardown(() => chrome(`Services.prefs.clearUserPref("${SORT_PREF}")`));
    const before = await chrome(`(async () => Services.prefs.getBoolPref("${SORT_PREF}"))()`);
    await open_page("about:preferences", `(win) => win.document.readyState === "complete"`);
    await start_hints("f", "about:preferences");
    await poll_until("HINT in the bar", async () => (await bar_mode()) === "HINT", { timeout_ms: 3000 });
    expect((await in_selected_page(`(win) => win.document.querySelectorAll(".desertfox-page-hints, .desertfox-chrome-hints").length`)) === 0, "a label went into the page's own DOM");
    await take_shot("/tmp/desertfox-page-hints-preferences.png");
    const section = await chrome(label_on(`(doc, deep_find) => { const host = doc.getElementById("category-tabs-browsing"); return host ? deep_find(host.openOrClosedShadowRoot ?? host, "button, a") ?? host : null; }`));
    expect(section !== null, "the Tabs and browsing section got no label");
    await press_keys(...section.split(""));
    await expect_ended("a pick of a section");
    const checkbox_shown = `(win) => { ${DEEP_FIND} return deep_find(win.document, "#ctrlTabRecentlyUsedOrder")?.checkVisibility() ?? false; }`;
    await poll_until("the Tabs and browsing section to show", () => in_selected_page(checkbox_shown), { timeout_ms: 5000 });
    expect(await scroll_to("#ctrlTabRecentlyUsedOrder"), "no Ctrl+Tab checkbox on the page");
    await sleep(300);
    await focus_page();
    await start_hints("f", "the Tabs and browsing section");
    const label = await chrome(label_on(`(doc, deep_find) => deep_find(doc, "#ctrlTabRecentlyUsedOrder")`));
    expect(label !== null, "the Ctrl+Tab checkbox got no label");
    await press_keys(...label.split(""));
    await poll_until("the pick to toggle the pref", async () => (await chrome(`(async () => Services.prefs.getBoolPref("${SORT_PREF}"))()`)) !== before, { timeout_ms: 3000 });
    await expect_ended("a pick on about:preferences");
  });

  await tab_case("on about:preferences a pick of the search box focuses it and the bar says INSERT, Escape then blurs it, and Escape in a session ends the session first", async () => {
    await home("ph_search");
    await open_page("about:preferences", `(win) => win.document.readyState === "complete"`);
    await start_hints("f", "about:preferences");
    await press_keys("-k", "Escape");
    await expect_ended("Escape in the session");
    expect(!(await chrome(in_field)), "the session's Escape reached a field");
    await start_hints("f", "about:preferences");
    const label = await chrome(label_on(`(doc, deep_find) => { const host = doc.getElementById("searchInput"); return host ? deep_find(host.openOrClosedShadowRoot ?? host, "input") ?? host : null; }`));
    expect(label !== null, "the search box got no label");
    await press_keys(...label.split(""));
    await expect_ended("a pick of the search box");
    await poll_until("the focus in the search box", () => chrome(in_field), { timeout_ms: 3000 });
    await poll_until("INSERT in the bar", async () => (await bar_mode()) === "INSERT", { timeout_ms: 3000 });
    await press_keys("-k", "Escape");
    await poll_until("Escape to blur the search box", async () => !(await chrome(in_field)), { timeout_ms: 3000 });
    await poll_until("NORMAL in the bar", async () => (await bar_mode()) === "NORMAL", { timeout_ms: 3000 });
  });

  await tab_case("on about:preferences F labels only web links and opens the picked one in a background tab, read from the page", async () => {
    await home("ph_link");
    await open_page("about:preferences", `(win) => win.document.readyState === "complete"`);
    const pick_link = `(doc, deep_find) => { const all = []; const walk = (root) => { for (const el of root.querySelectorAll("a[href]")) all.push(el); for (const el of root.querySelectorAll("*")) if (el.openOrClosedShadowRoot) walk(el.openOrClosedShadowRoot); }; walk(doc); return all.find((a) => /^https?:/.test(a.href) && a.checkVisibility() && a.getBoundingClientRect().width > 4 && a.getBoundingClientRect().top >= 0 && a.getBoundingClientRect().bottom <= doc.defaultView.innerHeight) ?? null; }`;
    const href = await in_selected_page(`(win) => { ${DEEP_FIND} return (${pick_link})(win.document, deep_find)?.href ?? null; }`);
    expect(href !== null, "about:preferences shows no web link in its first screen");
    await chrome(`(async () => { Services.desertfox_key_test_tabs_before = new Set(${W}.gBrowser.tabs); })()`);
    const tabs_before = await chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
    const selected_before = await chrome(`(async () => ${W}.gBrowser.selectedTab._tPos)()`);
    await start_hints("F", "F on about:preferences");
    const label = await chrome(label_on(pick_link));
    expect(label !== null, "the link got no label");
    await press_keys(...label.split(""));
    await poll_until("a new tab", async () => (await chrome(`(async () => ${W}.gBrowser.tabs.length)()`)) === tabs_before + 1, { timeout_ms: 3000 });
    const new_tab = `${W}.gBrowser.tabs.find((tab) => !Services.desertfox_key_test_tabs_before.has(tab))`;
    await poll_until("the new tab to take the link's address", async () => (await chrome(`(async () => { const b = ${new_tab}?.linkedBrowser; return b?.currentURI?.spec === ${JSON.stringify(href)} || b?.userTypedValue === ${JSON.stringify(href)}; })()`)) === true, { timeout_ms: 5000 });
    expect((await chrome(`(async () => ${W}.gBrowser.selectedTab._tPos)()`)) === selected_before, "F took the focus to the new tab");
    await chrome(`(async () => { ${W}.gBrowser.removeTab(${new_tab}); delete Services.desertfox_key_test_tabs_before; })()`);
    await expect_ended("F on about:preferences");
  });

  await tab_case("on about:addons a pick of the private window choice only marks it, a key other than Enter cancels, and the user's Enter picks it", async () => {
    await home("ph_addons");
    await open_page("about:addons", `(win) => win.document.readyState === "complete" && !!win.gViewController`);
    await in_selected_page(`(win) => (win.gViewController.loadView("detail/" + encodeURIComponent("desertfox@uhs-robert")), true)`);
    await poll_until("the details of DesertFox", () => in_selected_page(`(win) => !!win.document.querySelector('.addon-detail-row-private-browsing input[name="private-browsing"]')`), { timeout_ms: 8000 });
    await scroll_to(".addon-detail-row-private-browsing");
    await sleep(300);
    await focus_page();
    const checked = `(doc) => doc.querySelector('.addon-detail-row-private-browsing input[name="private-browsing"]:checked')`;
    const value_before = await in_selected_page(`(win) => (${checked})(win.document)?.value ?? null`);
    expect(value_before !== null, "no private window choice is checked");
    for (const key of ["j", "Enter"]) {
      await start_hints("f", "about:addons");
      const label = await chrome(label_on(checked));
      expect(label !== null, "the checked private window choice got no label");
      await press_keys(...label.split(""));
      await poll_until("the Enter mark", () => chrome(confirm_shown), { timeout_ms: 3000 });
      await take_shot("/tmp/desertfox-page-hints-addons-confirm.png");
      expect((await chrome(held_by)) === "chrome_hints", "the mark does not hold the window's keys");
      await sleep(700);
      await press_keys(...(key === "Enter" ? ["-k", "Return"] : [key]));
      await poll_until(`${key} to end the mark`, async () => !(await chrome(confirm_shown)), { timeout_ms: 3000 });
      await poll_until(`${key} to give the keys back`, async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
      expect((await in_selected_page(`(win) => (${checked})(win.document)?.value ?? null`)) === value_before, `${key} changed the private window access`);
    }
  });

  await tab_case("on about:config a pref toggle waits for Enter, and the risk warning's button never gets a label", async () => {
    await home("ph_config");
    on_teardown(() => chrome(`(async () => { Services.prefs.clearUserPref("${TEST_PREF}"); Services.prefs.clearUserPref("browser.aboutConfig.showWarning"); })()`));
    await chrome(`(async () => { Services.prefs.setBoolPref("browser.aboutConfig.showWarning", true); Services.prefs.setBoolPref("${TEST_PREF}", false); })()`);
    await open_page("about:config", `(win) => !!win.document.getElementById("warningButton")?.checkVisibility()`);
    await start_hints("f", "the about:config warning");
    expect((await chrome(label_on(`(doc) => doc.getElementById("warningButton")`))) === null, "the risk warning's button got a label");
    await press_keys("-k", "Escape");
    await expect_ended("Escape on the warning");
    await in_selected_page(`(win) => (win.document.getElementById("warningButton").click(), true)`);
    await poll_until("the search box", () => in_selected_page(`(win) => !!win.document.getElementById("about-config-search")`), { timeout_ms: 5000 });
    await in_selected_page(`(win) => { const search = win.document.getElementById("about-config-search"); search.value = "${TEST_PREF}"; search.dispatchEvent(new win.Event("input", { bubbles: true })); return true; }`);
    const toggle = `(doc) => [...doc.querySelectorAll("#prefs tr")].find((row) => row.textContent.includes("${TEST_PREF}"))?.querySelector(".button-toggle") ?? null`;
    await poll_until("the test pref's row", () => in_selected_page(`(win) => !!(${toggle})(win.document)`), { timeout_ms: 5000 });
    await focus_page();
    await start_hints("f", "about:config");
    const label = await chrome(label_on(toggle));
    expect(label !== null, "the pref's toggle got no label");
    await press_keys(...label.split(""));
    await poll_until("the Enter mark", () => chrome(confirm_shown), { timeout_ms: 3000 });
    expect((await chrome(`(async () => Services.prefs.getBoolPref("${TEST_PREF}"))()`)) === false, "the pick toggled the pref before Enter");
    await sleep(700);
    await press_keys("-k", "Return");
    await poll_until("Enter to toggle the pref", () => chrome(`(async () => Services.prefs.getBoolPref("${TEST_PREF}"))()`), { timeout_ms: 3000 });
  });

  for (const zoom of [1, 1.5]) {
    await tab_case(`on about:addons every link in view gets a label at zoom ${zoom}, the sidebar's too, and F and the copy take a web link`, async () => {
      await home("ph_addons_links");
      await open_page("about:addons", `(win) => win.document.readyState === "complete" && !!win.gViewController`);
      await in_selected_page(`(win) => (win.gViewController.loadView("addons://discover/"), true)`);
      await sleep(2500);
      await chrome(`(async () => { ${W}.gBrowser.selectedBrowser.fullZoom = ${zoom}; })()`);
      await sleep(500);
      await focus_page();
      const link_count = await in_selected_page(`(win) => { ${DEEP_FIND} return (${VISIBLE_LINKS})(win.document, deep_find).length; }`);
      expect(link_count >= 4, `about:addons shows only ${link_count} links in view`);
      await start_hints("f", `f on about:addons at zoom ${zoom}`);
      const missing = [];
      for (let index = 0; index < link_count; index++) {
        const label = await chrome(label_on(`(doc, deep_find) => (${VISIBLE_LINKS})(doc, deep_find)[${index}]`));
        if (label === null) missing.push(await in_selected_page(`(win) => { ${DEEP_FIND} return (${VISIBLE_LINKS})(win.document, deep_find)[${index}].href; }`));
      }
      expect(missing.length === 0, `links with no label at zoom ${zoom}: ${missing.join(" ")}`);
      await press_keys("-k", "Escape");
      await expect_ended("Escape in the session");
      const web_link = `(doc, deep_find) => (${VISIBLE_LINKS})(doc, deep_find).find((a) => /^https?:/.test(a.href))`;
      const href = await in_selected_page(`(win) => { ${DEEP_FIND} return (${web_link})(win.document, deep_find)?.href ?? null; }`);
      expect(href !== null, "about:addons shows no web link in view");
      await chrome(`(async () => { Services.desertfox_key_test_tabs_before = new Set(${W}.gBrowser.tabs); })()`);
      const tabs_before = await chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
      await start_hints("F", `F on about:addons at zoom ${zoom}`);
      const tab_label = await chrome(label_on(web_link));
      expect(tab_label !== null, "the web link got no F label");
      await press_keys(...tab_label.split(""));
      await poll_until("a new tab", async () => (await chrome(`(async () => ${W}.gBrowser.tabs.length)()`)) === tabs_before + 1, { timeout_ms: 3000 });
      const new_tab = `${W}.gBrowser.tabs.find((tab) => !Services.desertfox_key_test_tabs_before.has(tab))`;
      await poll_until("the new tab to take the address", async () => (await chrome(`(async () => { const b = ${new_tab}?.linkedBrowser; return b?.currentURI?.spec === ${JSON.stringify(href)} || b?.userTypedValue === ${JSON.stringify(href)}; })()`)) === true, { timeout_ms: 5000 });
      await chrome(`(async () => { ${W}.gBrowser.removeTab(${new_tab}); delete Services.desertfox_key_test_tabs_before; })()`);
      await expect_ended("F on about:addons");
      await focus_page();
      await press_keys(";", "y", "l");
      await poll_until(`;yl on about:addons at zoom ${zoom}: the labels to show`, async () => (await chrome(label_count)) > 0, { timeout_ms: 5000 });
      await sleep(LABELS_SEEN_MS);
      const copy_label = await chrome(label_on(web_link));
      expect(copy_label !== null, "the web link got no copy label");
      await press_keys(...copy_label.split(""));
      await poll_until("the copy", async () => (await chrome(clipboard_text)) === href, { timeout_ms: 5000 });
      await expect_ended(";yl on about:addons");
    });
  }

  await tab_case("a hint that needs page code says so on about:preferences and starts nothing", async () => {
    await home("ph_refused");
    await open_page("about:preferences", `(win) => win.document.readyState === "complete"`);
    await clear_notices();
    on_teardown(clear_notices);
    await press_keys(";", "v");
    await poll_until("the refusal", async () => (await notices()).includes("This hint does not run on this page"), { timeout_ms: 5000 });
    await poll_until("the start to give the keys back", async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
    expect((await chrome(page_layers)) === 0, "a refused hint drew labels");
    await clear_notices();
  });
}
