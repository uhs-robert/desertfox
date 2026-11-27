// The browser module on the other pages no content script reaches: Firefox's error pages, the restricted sites, the new tab and home pages, view-source, the JSON viewer, about:config, about:support and another extension's page.
// The restricted sites are stood in for by localhost on the extensions.webextensions.restrictedDomains list. KEY_TEST_NETWORK=1 also opens the real ones, which needs the network.
import { execFileSync } from "node:child_process";
import { createServer as create_http_server } from "node:http";
import { createServer as create_https_server } from "node:https";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { install_temporary_addon } from "./rdp.mjs";
import { make_article, module_steps } from "./browser_module_steps.mjs";

export const areas = ["tabs", "scroll"];

const REAL_RESTRICTED_SITES = ["https://addons.mozilla.org/en-US/firefox/", "https://support.mozilla.org/en-US/", "https://accounts.firefox.com/"];
const OTHER_ADDON_ID = "key-test-other@desertfox.test";

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, on_teardown, url_of, rdp, events } = context;
  const steps = module_steps(context);
  const { chrome, open_tab, focus_page, switches_one, scrolls, close_selected_tab, home, in_selected_page } = steps;
  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-module-coverage-"));
  const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

  // A j that scrolls when the page can, then a J that switches one tab.
  async function takes_keys(page, { scroll = false } = {}) {
    await focus_page();
    if (scroll) await scrolls("j", page);
    await switches_one(`J on ${page}`);
    // DesertFox takes K on the test page and comes back, so the case closes the tab it opened.
    await switches_one(`K back to ${page}`, ["K"]);
  }

  await setup("turn the module on", () => steps.turn_on_module());

  await run_case("the connection error page takes J", async () => {
    await home("bm_neterror");
    // A port that was just free has nothing behind it.
    const probe = create_http_server();
    const closed_port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    await open_tab(`http://127.0.0.1:${closed_port}/`, { loaded: (spec) => spec.includes(String(closed_port)) });
    await poll_until("the error page", () => in_selected_page(`(win) => win.document.documentURI.startsWith("about:neterror")`));
    await takes_keys("the connection error page");
    await close_selected_tab();
  });

  await run_case("the offline error page takes J", async () => {
    await home("bm_offline");
    const managed = await chrome(`(async () => Services.io.manageOfflineStatus)()`);
    on_teardown(() => chrome(`(async () => { Services.io.offline = false; Services.io.manageOfflineStatus = ${managed}; })()`));
    await chrome(`(async () => { Services.io.manageOfflineStatus = false; Services.io.offline = true; })()`);
    // Offline mode still lets loopback through, so the address names another host. Offline, Firefox looks up nothing.
    await open_tab("http://desertfox-offline.test/", { loaded: (spec) => spec.includes("desertfox-offline.test") });
    await poll_until("the offline page", async () => {
      const uri = await in_selected_page(`(win) => win.document.documentURI`);
      return uri.startsWith("about:neterror") && uri.includes("netOffline");
    });
    await chrome(`(async () => { Services.io.offline = false; })()`);
    await takes_keys("the offline error page");
    await close_selected_tab();
  });

  await run_case("the certificate error page takes J", async () => {
    await home("bm_certerror");
    const key = join(files_dir, "key.pem");
    const cert = join(files_dir, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
    const server = create_https_server({ key: readFileSync(key), cert: readFileSync(cert) }, (_request, response) => response.end("secret"));
    const port = await listen(server);
    on_teardown(() => new Promise((resolve) => server.close(resolve)));
    await open_tab(`https://127.0.0.1:${port}/`, { loaded: (spec) => spec.includes(String(port)) });
    await poll_until("the certificate error page", () => in_selected_page(`(win) => win.document.documentURI.startsWith("about:certerror")`));
    await takes_keys("the certificate error page");
    await close_selected_tab();
  });

  await run_case("a site on the restricted list runs no content script and takes J and j", async () => {
    await home("bm_restricted_home");
    const PREF = "extensions.webextensions.restrictedDomains";
    const before = await chrome(`(async () => Services.prefs.getStringPref("${PREF}", ""))()`);
    on_teardown(() => chrome(`(async () => Services.prefs.setStringPref("${PREF}", ${JSON.stringify(before)}))()`));
    await chrome(`(async () => Services.prefs.setStringPref("${PREF}", ${JSON.stringify(`${before},localhost`)}))()`);
    const restricted = url_of("page", "bm_restricted").replace("127.0.0.1", "localhost");
    const mark = events.length;
    await open_tab(restricted, { loaded: (spec) => spec.includes("bm_restricted") });
    await takes_keys("a restricted site", { scroll: true });
    expect(!events.slice(mark).some((event) => event.type === "tree_read" && event.page_id === "bm_restricted"), "the content script ran on a restricted site, so this case tests nothing");
    await close_selected_tab();
  });

  if (process.env.KEY_TEST_NETWORK === "1") {
    for (const url of REAL_RESTRICTED_SITES) {
      await run_case(`the real restricted site ${new URL(url).host} takes J`, async () => {
        await home(`bm_real_${new URL(url).host.replace(/\W/g, "_")}`);
        await open_tab(url, { loaded: (spec) => spec.includes(new URL(url).host) });
        await takes_keys(new URL(url).host);
        await close_selected_tab();
      });
    }
  }

  for (const page of ["about:newtab", "about:home"]) {
    await run_case(`${page} takes J once`, async () => {
      await home(`bm_${page.slice(6)}`);
      await open_tab(page, { loaded: () => true });
      await takes_keys(page);
      await close_selected_tab();
    });
  }

  await run_case("view-source takes J and j", async () => {
    await home("bm_view_source");
    const server = create_http_server((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(make_article()));
    const port = await listen(server);
    on_teardown(() => new Promise((resolve) => server.close(resolve)));
    await open_tab(`view-source:http://127.0.0.1:${port}/`, { loaded: (spec) => spec.startsWith("view-source:") });
    await takes_keys("view-source", { scroll: true });
    await close_selected_tab();
  });

  await run_case("the JSON viewer takes J and j", async () => {
    await home("bm_json");
    const json = join(files_dir, "data.json");
    writeFileSync(json, JSON.stringify(Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key_${index}`, { index, words: "desert fox" }]))));
    await open_tab(pathToFileURL(json).href, { loaded: (spec) => spec.endsWith("data.json") });
    await poll_until("the JSON viewer to draw its rows", () => in_selected_page(`(win) => win.document.querySelectorAll("tr").length > 50`), { timeout_ms: 8000 });
    await takes_keys("the JSON viewer", { scroll: true });
    await close_selected_tab();
  });

  for (const page of ["about:config", "about:support"]) {
    await run_case(`${page} takes J and j`, async () => {
      await home(`bm_${page.slice(6)}`);
      await open_tab(page);
      await takes_keys(page, { scroll: page === "about:support" });
      await close_selected_tab();
    });
  }

  await run_case("another extension's page takes J and j", async () => {
    await home("bm_other_addon");
    const addon_dir = join(files_dir, "other_addon");
    mkdirSync(addon_dir);
    writeFileSync(join(addon_dir, "manifest.json"), JSON.stringify({ manifest_version: 2, name: "Key test other add-on", version: "1.0", browser_specific_settings: { gecko: { id: OTHER_ADDON_ID } } }));
    writeFileSync(join(addon_dir, "page.html"), make_article());
    await install_temporary_addon(rdp, addon_dir);
    on_teardown(() => chrome(`(async () => { const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"); await (await AddonManager.getAddonByID("${OTHER_ADDON_ID}"))?.uninstall(); })()`));
    const page = await chrome(`(async () => WebExtensionPolicy.getByID("${OTHER_ADDON_ID}").getURL("page.html"))()`);
    await open_tab(page, { loaded: (spec) => spec === page });
    await takes_keys("another extension's page", { scroll: true });
    await close_selected_tab();
  });
}
