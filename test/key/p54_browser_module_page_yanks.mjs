// The page yanks (yy yc ym yo ys yt) on pages where no DesertFox page code runs: about:preferences in the parent process, the PDF viewer with browser_module_pages off, and a host on the restricted list (a localhost name, offline).
// Each key copies the tab's address or title in its own format, with the tracking parameters stripped, and nothing else changes. yL and yl, which need the page's links, still do nothing there.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { make_pdf, module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const HOST = "yanks.desertfox.test";
const RESTRICTED_PREF = "extensions.webextensions.restrictedDomains";
const TEST_PREFS = [RESTRICTED_PREF, "network.dns.localDomains", "dom.security.https_first"];
const SENTINEL = "desertfox-key-test-sentinel";

const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;
const set_clipboard = (text) => `(async () => { Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(${JSON.stringify(text)}); })()`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, run_line, on_teardown } = context;
  const steps = module_steps(context);
  const { chrome, open_tab, focus_page, close_selected_tab, home, selected_spec, session_value } = steps;

  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-module-yanks-"));
  writeFileSync(join(files_dir, "long.pdf"), make_pdf(2), "latin1");
  const pdf_url = pathToFileURL(join(files_dir, "long.pdf")).href;
  const server = createServer((request, response) => {
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>Yank page</title></head><body><a href="https://example.org/a">a</a></body></html>`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const restricted_url = `http://${HOST}:${port}/page?utm_source=news&k=1`;
  const restricted_stripped = `http://${HOST}:${port}/page?k=1`;

  await setup("turn the module on, with the PDF viewer's page code off, and the test host restricted", async () => {
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
    await home("py_home");
    await run_line(":set browser_module_pages false");
    await poll_until("the page code setting to be off in the snapshot", async () => (await session_value("desertfox_browser_module_snapshot_config"))?.value?.settings?.browser_module_pages === false, { timeout_ms: 8000 });
  });

  const tab_label = () => chrome(`(async () => ${W}.gBrowser.selectedTab.label)()`);

  for (const [page, open, stripped] of [
    ["about:preferences", () => open_tab("about:preferences"), undefined],
    ["the PDF viewer with browser_module_pages off", () => open_tab(pdf_url), undefined],
    ["a restricted host", () => open_tab(restricted_url, { loaded: (spec) => spec.includes(HOST) }), restricted_stripped],
  ]) {
    await run_case(`on ${page} each page yank copies the tab's address or title in its format`, async () => {
      try {
        await open();
        await focus_page();
        await sleep(500);
        const url = stripped ?? (await selected_spec());
        const title = await tab_label();
        expect(title !== "", `${page} has no tab title`);
        const expected = { yy: url, yc: url, ys: url, yt: title, ym: `[${title}](${url})`, yo: `[[${url}][${title}]]` };
        for (const [keys, text] of Object.entries(expected)) {
          await chrome(set_clipboard(SENTINEL));
          await press_keys(...keys.split(""));
          await poll_until(`${keys} on ${page}`, async () => (await chrome(clipboard_text)) === text, { timeout_ms: 5000 });
        }
        // The link yanks need the page's links, so the module leaves them alone.
        for (const keys of ["yL", "yl"]) {
          await chrome(set_clipboard(SENTINEL));
          await press_keys(...keys.split(""));
          await sleep(NO_EFFECT_MS);
          expect((await chrome(clipboard_text)) === SENTINEL, `${keys} on ${page} changed the clipboard`);
        }
      } finally {
        await close_selected_tab();
      }
    });
  }
}
