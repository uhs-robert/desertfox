// Hints on a host of Firefox's restricted list (browser_module/desertfox-content-hints.js), where no content script runs: offline, with a test host that network.dns.localDomains points at a server of this piece, added to extensions.webextensions.restrictedDomains in the test Firefox only.
// f labels the page in the window's layer, a spelled link goes, F and the copy take a link's address, an install link and a button wait for the user's Enter and the page never sees it, a scroll or a navigation ends the session, a closed tab and a process swap leave no hold, and a login page gets the notice.
// With KEY_TEST_NETWORK=1 it also labels a real addons.mozilla.org page and marks Add to Firefox, then leaves with Escape. It never confirms an install.
import { createServer } from "node:http";
import { module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["hints", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const SESSION_KEY = "desertfox_chrome_hints";
const HOST = "restricted.desertfox.test";
const RESTRICTED_PREF = "extensions.webextensions.restrictedDomains";
const TEST_PREFS = [RESTRICTED_PREF, "network.dns.localDomains", "dom.security.https_first"];
// LABELS_SEEN_MS of the module, with a margin.
const LABELS_SEEN_MS = 400;
// The grant's dwell of the module, with a margin.
const DWELL_MS = 700;
const NOT_HERE_NOTICE = "Hints do not run on this page";
const AMO_LISTING = "https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/";

const label_count = `(async () => [...${W}.document.querySelectorAll(".desertfox-page-hints")].reduce((sum, host) => sum + host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint").length, 0))()`;
const page_layers = `(async () => ${W}.document.querySelectorAll(".desertfox-page-hints").length)()`;
const confirm_shown = `(async () => [...${W}.document.querySelectorAll(".desertfox-page-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`;
const held_by = `(async () => Services.desertfox_browser_module.keys_held_by(${W}) ?? null)()`;
const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;

// A mock add-on listing. Each control the module may click tells the server, so a click shows even after its tab is gone. The install link never loads its file.
const LISTING = `<!doctype html><html><head><meta charset="utf-8"><title>listing</title>
<style>body { margin: 0; font: 16px sans-serif; } .at { position: absolute; }</style></head><body>
<a id="next" class="at" href="/other" style="left: 40px; top: 40px">Next page</a>
<a id="install" class="at" href="/firefox/downloads/file/1/x.xpi" style="left: 240px; top: 40px">Add to Firefox</a>
<button id="rate" class="at" style="left: 440px; top: 40px">Rate</button>
<form class="at" action="/post" method="post" style="left: 40px; top: 120px"><input id="q" name="q"> <button id="send" type="submit">Send</button></form>
<input id="search" class="at" type="search" style="left: 40px; top: 200px">
<div style="height: 4000px"></div>
<script>
const tell = (what) => navigator.sendBeacon("/event?" + what);
addEventListener("keydown", (event) => event.key === "Enter" && tell("enter"), true);
document.getElementById("install").addEventListener("click", (event) => { event.preventDefault(); tell("install"); });
document.getElementById("rate").addEventListener("click", () => tell("rate"));
document.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); tell("submit"); });
const nav = new URLSearchParams(location.search).get("nav");
if (nav) setTimeout(() => { location.href = "/other?from=timer"; }, Number(nav));
</script></body></html>`;
const OTHER = `<!doctype html><html><head><meta charset="utf-8"><title>other</title></head><body><a href="/listing">back</a></body></html>`;
const LOGIN = `<!doctype html><html><head><meta charset="utf-8"><title>login</title></head><body><a href="/other" style="position: absolute; left: 40px; top: 40px">help</a><form style="position: absolute; left: 40px; top: 100px"><input type="password" name="p"></form></body></html>`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, on_teardown, in_background, clear_notices, take_shot } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, focus_page, close_selected_tab, home, in_selected_page, selected_spec } = steps;

  const events = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://x");
    if (url.pathname === "/event") {
      events.push(url.search.slice(1));
      return response.writeHead(204).end();
    }
    const body = { "/listing": LISTING, "/other": OTHER, "/login": LOGIN }[url.pathname];
    response.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" }).end(body ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const origin = `http://${HOST}:${port}`;
  const other_site = `http://127.0.0.1:${port}`;
  const count = (what) => events.filter((event) => event === what).length;

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
    await sleep(LABELS_SEEN_MS);
  }
  async function expect_ended(what) {
    await poll_until(`${what}: the layer to go`, async () => (await chrome(page_layers)) === 0, { timeout_ms: 3000 });
    await poll_until(`${what}: the hold to go`, async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
    await poll_until(`${what}: the extension to drop its session`, async () => (await session_value(SESSION_KEY)) === null, { timeout_ms: 3000 });
  }
  async function open_listing(path = "/listing") {
    await open_tab(`${origin}${path}`);
    await poll_until(`${path} to load`, () => in_selected_page(`(win) => win.document.readyState === "complete" && !!win.document.body`), { timeout_ms: 10000 });
    await focus_page();
  }
  // The label over the page's element: its box in the page, scaled by the page's zoom and placed in the tab's area. Firefox's own numbers on both sides, so the module's math is not checked against itself.
  async function label_on(selector) {
    const where = await in_selected_page(`(win) => { const rect = win.document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, dpr: win.devicePixelRatio } : null; }`);
    if (!where) return null;
    return chrome(`(async () => {
      const w = ${W};
      const area = w.gBrowser.selectedBrowser.getBoundingClientRect();
      const scale = ${where.dpr} / w.devicePixelRatio;
      const x = Math.max(area.left, area.left + ${where.left} * scale), y = Math.max(area.top, area.top + ${where.top} * scale);
      let best = null, best_distance = Infinity;
      for (const host of w.document.querySelectorAll(".desertfox-page-hints")) for (const node of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
        const box = node.getBoundingClientRect();
        const distance = Math.abs(box.left - x) + Math.abs(box.top - y);
        if (distance < best_distance) [best, best_distance] = [node.textContent, distance];
      }
      return best_distance <= 3 ? best : null;
    })()`);
  }
  async function pick(selector) {
    const label = await label_on(selector);
    expect(label !== null, `${selector} got no label`);
    await press_keys(...label.split(""));
  }

  await setup("turn the module on, and point the test host at this piece's server as a restricted host", async () => {
    const saved = await chrome(`(async () => Object.fromEntries(${JSON.stringify(TEST_PREFS)}.map((name) => [name, Services.prefs.prefHasUserValue(name) ? Services.prefs.getPrefType(name) === Services.prefs.PREF_BOOL ? Services.prefs.getBoolPref(name) : Services.prefs.getStringPref(name) : null])))()`);
    on_teardown(() =>
      chrome(`(async () => {
        for (const [name, value] of Object.entries(${JSON.stringify(saved)})) {
          if (value === null) Services.prefs.clearUserPref(name);
          else if (typeof value === "boolean") Services.prefs.setBoolPref(name, value);
          else Services.prefs.setStringPref(name, value);
        }
      })()`),
    );
    await chrome(`(async () => {
      Services.prefs.setStringPref("network.dns.localDomains", "${HOST}");
      Services.prefs.setStringPref("${RESTRICTED_PREF}", Services.prefs.getStringPref("${RESTRICTED_PREF}", "") + ",${HOST}");
      Services.prefs.setBoolPref("dom.security.https_first", false);
    })()`);
    await steps.turn_on_module();
    await poll_until("the state to say the extension answers page hints", async () => (await session_value("desertfox_browser_module_state"))?.page_hints === true, { timeout_ms: 5000 });
  });

  await tab_case("the test host resolves offline and is restricted, so no content script runs there, and f labels it in the window's layer and a spelled link goes", async () => {
    await home("ch_follow");
    expect(await chrome(`(async () => WebExtensionPolicy.isRestrictedURI(Services.io.newURI("${origin}/listing")))()`), "the test host is not on Firefox's restricted list");
    await open_listing();
    expect((await in_selected_page(`(win) => win.document.title`)) === "listing", "the test host did not reach the piece's server");
    await sleep(500);
    expect((await in_selected_page(`(win) => win.document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`)) === false, "DesertFox's content script runs on a restricted host");
    expect(await chrome(`(async () => Services.desertfox_browser_module.page_hints()?.handles(${W}.gBrowser.selectedBrowser) ?? false)()`), "the module does not label the restricted page");
    await start_hints("f", "f on the restricted page");
    const shown = await chrome(label_count);
    expect(shown >= 6, `only ${shown} labels on the listing`);
    expect((await in_selected_page(`(win) => win.document.querySelectorAll("[class*=desertfox]").length`)) === 0, "a label went into the page's DOM");
    await take_shot("/tmp/desertfox-content-hints-listing.png");
    await pick("#next");
    await poll_until("the link to load its page", async () => (await selected_spec()) === `${origin}/other`, { timeout_ms: 5000 });
    await expect_ended("a pick of a link");
  });

  await tab_case("F opens a link in a background tab and the copy takes its address, read from the page; neither labels the install link or a button", async () => {
    await home("ch_links");
    await open_listing();
    const tabs_before = await chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
    const selected_before = await chrome(`(async () => ${W}.gBrowser.selectedTab._tPos)()`);
    await start_hints("F", "F on the restricted page");
    expect((await label_on("#install")) === null && (await label_on("#rate")) === null, "F labelled a control that is no plain link");
    await pick("#next");
    await poll_until("a new tab", async () => (await chrome(`(async () => ${W}.gBrowser.tabs.length)()`)) === tabs_before + 1, { timeout_ms: 3000 });
    expect((await chrome(`(async () => ${W}.gBrowser.selectedTab._tPos)()`)) === selected_before, "F took the focus to the new tab");
    await poll_until("the new tab to take the link's address", () => chrome(`(async () => ${W}.gBrowser.tabs.some((tab) => { const b = tab.linkedBrowser; return b.currentURI?.spec === "${origin}/other" || b.userTypedValue === "${origin}/other"; }))()`), { timeout_ms: 5000 });
    await chrome(`(async () => { const w = ${W}; const tab = [...w.gBrowser.tabs].find((each) => each !== w.gBrowser.selectedTab && (each.linkedBrowser.currentURI?.spec === "${origin}/other" || each.linkedBrowser.userTypedValue === "${origin}/other")); if (tab) w.gBrowser.removeTab(tab); })()`);
    await expect_ended("F on the restricted page");
    await focus_page();
    await press_keys(";", "y", "l");
    await poll_until(";yl: the labels to show", async () => (await chrome(label_count)) > 0, { timeout_ms: 5000 });
    await sleep(LABELS_SEEN_MS);
    await pick("#next");
    await poll_until("the copy", async () => (await chrome(clipboard_text)) === `${origin}/other`, { timeout_ms: 5000 });
    await expect_ended(";yl on the restricted page");
  });

  await tab_case("an install link and a button only mark; another key cancels with no click, and the user's Enter clicks once and never reaches the page", async () => {
    await home("ch_grant");
    await open_listing();
    for (const [selector, event] of [["#install", "install"], ["#rate", "rate"], ["#send", "submit"]]) {
      await start_hints("f", `f for ${selector}`);
      await pick(selector);
      await poll_until(`the Enter mark on ${selector}`, () => chrome(confirm_shown), { timeout_ms: 3000 });
      if (selector === "#install") await take_shot("/tmp/desertfox-content-hints-confirm.png");
      expect((await chrome(held_by)) === "chrome_hints", "the mark does not hold the window's keys");
      await sleep(NO_EFFECT_MS);
      expect(count(event) === 0, `${selector} acted before Enter`);
      await press_keys("j");
      await poll_until("j to end the mark", async () => !(await chrome(confirm_shown)), { timeout_ms: 3000 });
      await sleep(NO_EFFECT_MS);
      expect(count(event) === 0, `j clicked ${selector}`);
      await focus_page();
      await start_hints("f", `f again for ${selector}`);
      await pick(selector);
      await poll_until(`the Enter mark on ${selector} again`, () => chrome(confirm_shown), { timeout_ms: 3000 });
      await sleep(DWELL_MS);
      await press_keys("-k", "Return");
      await poll_until(`Enter to click ${selector}`, async () => count(event) === 1, { timeout_ms: 3000 });
      await poll_until("Enter to give the keys back", async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
      await sleep(NO_EFFECT_MS);
      expect(count(event) === 1, `${selector} was clicked ${count(event)} times`);
      expect(count("enter") === 0, "the page saw the Enter");
      await focus_page();
    }
  });

  await tab_case("a scroll in the page ends the session, and so does a navigation the page starts while the labels show", async () => {
    await home("ch_gone");
    const seen_before = events.length;
    await open_listing();
    await start_hints("f", "f before a scroll");
    await in_selected_page(`(win) => (win.scrollBy(0, 60), true)`);
    await expect_ended("a scroll in the page");
    await in_selected_page(`(win) => (win.scrollTo(0, 0), true)`);
    await open_listing("/listing?nav=2500");
    await start_hints("f", "f before the page's own navigation");
    await poll_until("the page to navigate itself", async () => (await selected_spec()) === `${origin}/other?from=timer`, { timeout_ms: 5000 });
    await expect_ended("a navigation mid-session");
    expect(events.length === seen_before, `the page saw ${JSON.stringify(events.slice(seen_before))}`);
  });

  await run_case("a tab closed mid-confirm leaves no mark, no hold and no click", async () => {
    await home("ch_close");
    await open_listing();
    const before = count("install");
    await start_hints("f", "f before the close");
    await pick("#install");
    await poll_until("the Enter mark", () => chrome(confirm_shown), { timeout_ms: 3000 });
    await close_selected_tab();
    await poll_until("the mark to go with its tab", async () => !(await chrome(confirm_shown)), { timeout_ms: 3000 });
    await poll_until("the hold to go with its tab", async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
    await sleep(DWELL_MS);
    await press_keys("-k", "Return");
    await sleep(NO_EFFECT_MS);
    expect(count("install") === before, "the install link was clicked after its tab closed");
  });

  await tab_case("a navigation to another site (a process swap) with the labels shown, then a mark shown, leaves no stale labels, mark or hold", async () => {
    await home("ch_swap");
    await open_listing();
    const pid_before = await chrome(`(async () => ${W}.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal?.domProcess?.osPid ?? null)()`);
    await start_hints("f", "f before the swap");
    await in_selected_page(`(win) => { win.location.href = "${other_site}/other"; return true; }`);
    await poll_until("the other site to load", async () => (await selected_spec()) === `${other_site}/other`, { timeout_ms: 5000 });
    await expect_ended("a process swap mid-session");
    const pid_after = await chrome(`(async () => ${W}.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal?.domProcess?.osPid ?? null)()`);
    console.log(`content hints swap: pid ${pid_before} -> ${pid_after}`);
    await open_listing();
    const before = count("install");
    await start_hints("f", "f before the swap with a mark");
    await pick("#install");
    await poll_until("the Enter mark", () => chrome(confirm_shown), { timeout_ms: 3000 });
    await in_selected_page(`(win) => { win.location.href = "${other_site}/other"; return true; }`);
    await poll_until("the mark to go with the page", async () => !(await chrome(confirm_shown)), { timeout_ms: 5000 });
    await poll_until("the hold to go with the page", async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
    expect(count("install") === before, "the swap clicked the install link");
  });

  await tab_case("a login page on a restricted host gets the notice and no labels", async () => {
    await home("ch_login");
    await open_listing("/login");
    await clear_notices();
    on_teardown(clear_notices);
    await press_keys("f");
    await poll_until("the notice on the login page", async () => (await notices()).includes(NOT_HERE_NOTICE), { timeout_ms: 5000 });
    expect((await chrome(page_layers)) === 0, "the login page got labels");
    await poll_until("the start to give the keys back", async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
    await clear_notices();
  });

  // Firefox's start pages run in the privilegedabout process, which the route labels by the page's own about: address.
  const EXTENSION_ID = "desertfox@uhs-robert";
  const route_kind = `(async () => Services.desertfox_browser_module.content_pages()?.labels(${W}.gBrowser.selectedBrowser) ?? null)()`;
  async function expect_start_page_labels(page, kind, shot) {
    await poll_until(`${page} to be the selected page in privilegedabout`, async () => (await chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; return b.currentURI.spec === "${page}" && b.remoteType === "privilegedabout"; })()`)), { timeout_ms: 10000 });
    await focus_page();
    expect((await chrome(route_kind)) === kind, `${page} is not a ${kind} page of the route`);
    await start_hints("f", `f on ${page}`);
    const shown = await chrome(label_count);
    expect(shown >= 1, `${page} got no labels`);
    await take_shot(shot);
    await press_keys("-k", "Escape");
    await expect_ended(`Escape on ${page}`);
  }

  await tab_case("about:home in a normal window gets module labels in the window's layer", async () => {
    await home("ch_home");
    await open_tab("about:home");
    await expect_start_page_labels("about:home", "home", "/tmp/desertfox-content-hints-about-home.png");
  });

  await run_case("about:privatebrowsing in a private window gets module labels when the extension may run there", async () => {
    const policy = `WebExtensionPolicy.getByID("${EXTENSION_ID}")`;
    const was_allowed = await chrome(`(async () => ${policy}.privateBrowsingAllowed)()`);
    const set_access = (allowed) =>
      chrome(`(async () => {
        const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
        const { extension } = ${policy};
        const change = { permissions: ["internal:privateBrowsingAllowed"], origins: [] };
        await (${allowed} ? ExtensionPermissions.add("${EXTENSION_ID}", change, extension) : ExtensionPermissions.remove("${EXTENSION_ID}", change, extension));
      })()`);
    const close_private = () => chrome(`(async () => { const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs"); for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (PrivateBrowsingUtils.isWindowPrivate(w)) w.close(); })()`);
    on_teardown(close_private);
    on_teardown(() => set_access(was_allowed));
    await set_access(true);
    await poll_until("DesertFox to gain private window access", async () => (await chrome(`(async () => ${policy}.privateBrowsingAllowed)()`)) === true);
    await chrome(`(async () => {
      const w = Services.wm.getMostRecentWindow("navigator:browser").OpenBrowserWindow({ private: true });
      await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished"));
    })()`);
    await poll_until("the private window to show about:privatebrowsing", async () => (await selected_spec()) === "about:privatebrowsing", { timeout_ms: 10000 });
    await expect_start_page_labels("about:privatebrowsing", "privatebrowsing", "/tmp/desertfox-content-hints-about-privatebrowsing.png");
    await close_private();
  });

  const online = process.env.KEY_TEST_NETWORK === "1" && (await fetch(AMO_LISTING, { method: "HEAD", signal: AbortSignal.timeout(3000) }).then((response) => response.ok, () => false));
  if (!online) console.log("content hints: the real addons.mozilla.org case is skipped (set KEY_TEST_NETWORK=1 with a network)");
  else {
    await tab_case("on a real addons.mozilla.org listing f labels the page and a pick of Add to Firefox only marks it", async () => {
      await home("ch_amo");
      await open_tab(AMO_LISTING);
      const install = `(win) => [...win.document.querySelectorAll("a, button")].find((el) => /add to firefox/i.test(el.textContent) && el.checkVisibility())`;
      await poll_until("the listing's Add to Firefox", () => in_selected_page(`(win) => !!(${install})(win)`), { timeout_ms: 15000 });
      await focus_page();
      await start_hints("f", "f on addons.mozilla.org");
      expect((await chrome(label_count)) > 5, "addons.mozilla.org got few labels");
      await in_selected_page(`(win) => { (${install})(win).id ||= "desertfox-key-test-install"; return true; }`);
      await pick("#desertfox-key-test-install");
      await poll_until("the Enter mark on Add to Firefox", () => chrome(confirm_shown), { timeout_ms: 3000 });
      await take_shot("/tmp/desertfox-content-hints-amo.png");
      await press_keys("-k", "Escape");
      await poll_until("Escape to end the mark", async () => !(await chrome(confirm_shown)), { timeout_ms: 3000 });
    });
  }
}
