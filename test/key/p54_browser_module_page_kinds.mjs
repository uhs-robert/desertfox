// DesertFox's page code on view-source:, the JSON viewer and a blob: page shown in its tab, which the browser module runs there (browser_module/desertfox-locked-pages.js) while browser_module_pages is on.
// Hints and yy on each, a move from a web page to its source and back, a reload of the JSON viewer, and view-source: of another extension's page, which never gets page code. p54_browser_module_page_code covers the PDF viewer and Reader View.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { install_temporary_addon } from "./rdp.mjs";
import { make_article, module_steps } from "./browser_module_steps.mjs";

export const areas = ["hints", "bundles"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;
const CONFIG_SNAPSHOT_KEY = "desertfox_browser_module_snapshot_config";
const SANDBOX_NAME = "DesertFox page code";
const JSON_VIEWER_PRINCIPAL = "resource://devtools/client/jsonview/";
const OTHER_ADDON_ID = "key-test-page-kinds@desertfox.test";

const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;
const set_clipboard = (text) => `(async () => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(${JSON.stringify(text)}))()`;

const HINT_LABEL_COUNT = `(win) => {
  const host = [...win.document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}");
  return host?.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint").length ?? 0;
}`;
const HINT_LAYERS = `(win) => [...win.document.documentElement.children].filter((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}").length`;
// DesertFox's keydown listeners on the page, counted as the module's report counts them: by the add-on id in their sandbox.
const PAGE_CODE_LISTENERS = `(win) => {
  const service = Components.classes["@mozilla.org/eventlistenerservice;1"].getService(Components.interfaces.nsIEventListenerService);
  let count = 0;
  for (const target of [win, win.document, win.document.documentElement]) {
    for (const info of service.getListenerInfoFor(target)) {
      if (info.type !== "keydown") continue;
      try { if (Components.utils.getSandboxMetadata(Components.utils.getGlobalForObject(info.listenerObject))?.addonId === "desertfox@uhs-robert") count++; } catch {}
    }
  }
  return count;
}`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, run_line, rdp, on_teardown } = context;
  const steps = module_steps(context);
  const { chrome, open_tab, focus_page, in_selected_page, close_selected_tab, home, selected_spec, session_value, wait_loaded } = steps;
  const server = createServer((request, response) => {
    // The page makes a blob: of HTML and shows it in its own tab, so the blob: carries this page's http principal.
    if (request.url === "/to_blob")
      return response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(`<!doctype html><title>to blob</title><script>location.href = URL.createObjectURL(new Blob([${JSON.stringify(`<!doctype html><title>blob</title><p><a href="${origin}/target">the target link</a> <a href="${origin}/other">another link</a></p>`)}], { type: "text/html" }));</script>`);
    if (request.url === "/data.json") return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ link: `${origin}/target`, list: [1, 2, 3], words: "desert fox" }));
    // Hints label only what shows, so the links sit at the top of the page and of its source.
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>links</title><p><a href="/target">the target link</a> <a href="/other">another link</a></p>${make_article()}`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-page-kinds-"));
  writeFileSync(join(files_dir, "links.html"), `<!doctype html><title>links</title><p><a href="${origin}/target">the target link</a> <a href="${origin}/other">another link</a></p>`);
  const source_ready = `(win) => win.document.documentURI.startsWith("view-source:") && !!win.document.querySelector("a[href]")`;
  const http_source = { url: `view-source:${origin}/article`, ready: source_ready };
  // view-source: of an http page is no secure context, even on 127.0.0.1, so the clipboard refuses a page's write there and yy fails as on any plain http page. view-source: of a file page is one.
  const pages = {
    "view-source: of a file page": { url: `view-source:${pathToFileURL(join(files_dir, "links.html")).href}`, ready: source_ready },
    "the JSON viewer": { url: `${origin}/data.json`, ready: `(win) => win.document.nodePrincipal.spec === "${JSON_VIEWER_PRINCIPAL}" && win.document.querySelectorAll("tr").length > 1` },
    "a blob: page": { url: `${origin}/to_blob`, loaded: (spec) => spec.startsWith("blob:http:"), ready: `(win) => win.document.documentURI.startsWith("blob:http:") && !!win.document.querySelector("a[href]")` },
  };

  const page_code_ran = () => in_selected_page(`(win) => win.document.documentElement?.hasAttribute("data-desertfox-tree-read-ms") ?? false`);
  const hint_labels = () => in_selected_page(HINT_LABEL_COUNT);
  const listeners = () => in_selected_page(PAGE_CODE_LISTENERS);
  // The page code's realms in every process, after a collection, so a realm that is only waiting for one does not count. `of_kind` keeps those whose principal names it, so a tab that an earlier failed case left open does not count.
  const page_code_realms = async (of_kind = "") => (await all_page_code_realms()).filter((realm) => realm.includes(of_kind));
  const all_page_code_realms = () =>
    chrome(`(async () => {
      const manager = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
      await new Promise((resolve) => manager.minimizeMemoryUsage(resolve));
      const realms = new Set();
      await new Promise((resolve) => manager.getReports((process, path) => { if (path.startsWith("js-main-runtime-realms/") && path.endsWith("${SANDBOX_NAME}")) realms.add(process + " " + path); }, null, resolve, null, false));
      return [...realms];
    })()`);
  const load_in_tab = (url) => chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; b.loadURI(Services.io.newURI(${JSON.stringify(url)}), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); })()`);

  const wait_page_code = (what) => poll_until(`the page code to start on ${what}`, async () => (await page_code_ran()) && (await listeners()) > 0, { timeout_ms: 8000 });
  async function open_kind(name) {
    await open_tab(pages[name].url, pages[name].loaded && { loaded: pages[name].loaded });
    await poll_until(`${name} to draw`, () => in_selected_page(pages[name].ready), { timeout_ms: 10000 });
    await wait_page_code(name);
    await focus_page();
  }
  async function hints_show(what) {
    await press_keys("f");
    await poll_until(`hint labels on ${what}`, async () => (await hint_labels()) > 0, { timeout_ms: 5000 });
    expect((await in_selected_page(HINT_LAYERS)) === 1, `${what} has more than one hint layer`);
    await press_keys("-k", "Escape");
    await poll_until(`the labels on ${what} to go`, async () => (await hint_labels()) === 0, { timeout_ms: 3000 });
  }
  // yy goes through a page call to the background, which copies the tab's own address.
  async function yank_copies_address(what) {
    await chrome(set_clipboard("before the yank"));
    await press_keys("y", "y");
    await poll_until(`yy on ${what}`, async () => (await chrome(clipboard_text)) !== "before the yank", { timeout_ms: 5000 });
    const copied = await chrome(clipboard_text);
    const address = await selected_spec();
    expect(copied === address, `yy on ${what} copied ${JSON.stringify(copied)}, the tab shows ${address}`);
  }

  await setup("turn the module and the page code on", async () => {
    await steps.turn_on_module();
    await run_line(":set browser_module_pages true");
    await poll_until("the config snapshot with the setting on", async () => (await session_value(CONFIG_SNAPSHOT_KEY))?.value?.settings?.browser_module_pages === true);
  });

  for (const name of Object.keys(pages)) {
    await run_case(`f shows labels on ${name}, and yy copies its address`, async () => {
      await home(`pk_${name.replace(/\W+/g, "_")}`);
      await open_kind(name);
      await hints_show(name);
      await yank_copies_address(name);
      await close_selected_tab();
    });
  }

  await run_case("a web page, then view-source: in the same tab, then Back and Forward, keep one page code and no realm behind", async () => {
    await home("pk_nav");
    await open_tab(`${origin}/article`);
    await poll_until("the content script on the web page", () => page_code_ran(), { timeout_ms: 8000 });
    expect((await page_code_realms("view-source")).length === 0, "a web page runs the content script, not the module's page code");
    await load_in_tab(http_source.url);
    await wait_loaded((spec) => spec.startsWith("view-source:"));
    await poll_until("view-source: to draw", () => in_selected_page(http_source.ready), { timeout_ms: 10000 });
    await wait_page_code("view-source:");
    const listeners_first = await listeners();
    const realms_first = await page_code_realms("view-source");
    expect(realms_first.length === 1, `view-source: has ${realms_first.length} page code realms: ${realms_first.join("; ")}`);
    await chrome(`(async () => ${W}.gBrowser.selectedBrowser.goBack())()`);
    await wait_loaded((spec) => spec === `${origin}/article`);
    await poll_until("the content script on the web page again", () => page_code_ran(), { timeout_ms: 8000 });
    await focus_page();
    await hints_show("the web page after Back");
    console.log(`realms back on the web page: ${JSON.stringify(await page_code_realms())}`);
    await chrome(`(async () => ${W}.gBrowser.selectedBrowser.goForward())()`);
    await wait_loaded((spec) => spec.startsWith("view-source:"));
    await poll_until("view-source: again", () => in_selected_page(http_source.ready), { timeout_ms: 10000 });
    await wait_page_code("view-source: after Forward");
    expect((await listeners()) === listeners_first, `the page code listens ${await listeners()} times after Forward, ${listeners_first} before`);
    const realms_again = await page_code_realms("view-source");
    expect(realms_again.length === 1, `after Forward the page code has ${realms_again.length} realms: ${realms_again.join("; ")}`);
    await focus_page();
    await hints_show("view-source: after Forward");
    await close_selected_tab();
    await poll_until("no page code realm once the tab closed", async () => (await page_code_realms("view-source")).length === 0, { timeout_ms: 8000 });
  });

  await run_case("a reload of the JSON viewer starts one page code for the new document and leaves no realm behind", async () => {
    await home("pk_json_reload");
    await open_kind("the JSON viewer");
    const listeners_first = await listeners();
    const inner_window = () => chrome(`(async () => ${W}.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal?.innerWindowId ?? null)()`);
    const inner_first = await inner_window();
    await chrome(`(async () => ${W}.gBrowser.selectedBrowser.reload())()`);
    await poll_until("the reload's new document", async () => (await inner_window()) !== inner_first, { timeout_ms: 10000 });
    await wait_loaded((spec) => spec.endsWith("/data.json"));
    await poll_until("the JSON viewer to draw again", () => in_selected_page(pages["the JSON viewer"].ready), { timeout_ms: 10000 });
    await wait_page_code("the reloaded JSON viewer");
    expect((await listeners()) === listeners_first, `the page code listens ${await listeners()} times after the reload, ${listeners_first} before`);
    const realms = await page_code_realms("jsonview");
    expect(realms.length === 1, `after the reload the page code has ${realms.length} realms: ${realms.join("; ")}`);
    await focus_page();
    await hints_show("the reloaded JSON viewer");
    await yank_copies_address("the reloaded JSON viewer");
    await close_selected_tab();
  });

  await run_case("view-source: of another extension's page gets no page code", async () => {
    await home("pk_other_source");
    const addon_dir = mkdtempSync(join(tmpdir(), "desertfox-page-kinds-addon-"));
    writeFileSync(join(addon_dir, "manifest.json"), JSON.stringify({ manifest_version: 2, name: "Key test page kinds add-on", version: "1.0", browser_specific_settings: { gecko: { id: OTHER_ADDON_ID } } }));
    writeFileSync(join(addon_dir, "page.html"), `<!doctype html><title>other</title><p><a href="https://example.org/">a link</a></p>`);
    await install_temporary_addon(rdp, addon_dir);
    on_teardown(() => chrome(`(async () => { const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"); await (await AddonManager.getAddonByID("${OTHER_ADDON_ID}"))?.uninstall(); })()`));
    const page = await chrome(`(async () => WebExtensionPolicy.getByID("${OTHER_ADDON_ID}").getURL("page.html"))()`);
    await open_tab(`view-source:${page}`, { loaded: (spec) => spec.startsWith("view-source:moz-extension:") });
    await poll_until("the source to draw", () => in_selected_page(`(win) => win.document.readyState === "complete"`), { timeout_ms: 10000 });
    await sleep(1500);
    expect((await page_code_realms("view-source:moz-extension")).length === 0, "view-source: of another extension's page got page code");
    expect((await listeners()) === 0, "DesertFox listens on view-source: of another extension's page");
    await close_selected_tab();
  });
}
