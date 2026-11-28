// yL and yl on pages where no DesertFox page code runs: about:preferences in the parent process, a host on the restricted list (a localhost name, offline), and the pages the module refuses.
// The module reads the page's links and DesertFox formats, strips, dedupes and copies them, as on a web page. The PDF viewer and Reader View with browser_module_pages off are read by the content hints frame script.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { make_tmp_dir } from "../support/tmp_dir.ts";
import { make_article, make_linked_pdf, module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const HOST = "links.desertfox.test";
const RESTRICTED_PREF = "extensions.webextensions.restrictedDomains";
const TEST_PREFS = [RESTRICTED_PREF, "network.dns.localDomains", "dom.security.https_first"];
const SENTINEL = "desertfox-key-test-sentinel";
const NO_LINKS_HERE = "Links cannot be read on this page";

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

// Known links: a tracked one, its duplicate, a relative one, a mail link, a fragment of the page itself, a link with no text but a box, and one far below the first screen.
const links_page = (port) => `<!doctype html><html><head><meta charset="utf-8"><title>Link page</title></head><body>
<p><a href="https://example.org/first?utm_source=news&k=1">First</a></p>
<p><a href="https://example.org/first?k=1&utm_medium=mail">First again</a></p>
<p><a href="/relative/path">Relative</a></p>
<p><a href="mailto:someone@example.org">Mail</a></p>
<p><a href="#top">Top of this page</a></p>
<p><a href="https://example.org/bare" style="display: inline-block; width: 40px; height: 10px"></a></p>
<div style="height: 4000px"></div>
<p><a href="https://example.org/far-below">Far below</a></p>
</body></html>`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, run_line, on_teardown, in_background, clear_notices } = context;
  const steps = module_steps(context);
  const { chrome, open_tab, focus_page, close_selected_tab, home, selected_spec, session_value } = steps;

  const files_dir = make_tmp_dir("desertfox-module-links-");
  on_teardown(() => rm(files_dir, { recursive: true, force: true }));
  writeFileSync(join(files_dir, "linked.pdf"), make_linked_pdf("https://example.org/from-the-pdf"), "latin1");
  const pdf_url = pathToFileURL(join(files_dir, "linked.pdf")).href;
  let port = 0;
  const server = createServer((request, response) => {
    if (request.url === "/article") return response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(make_article().replace("</article>", `<p>See <a href="/target?utm_source=news&k=1">the target link</a> and <a href="#top">the top</a>.</p></article>`));
    const body = request.url?.startsWith("/empty") ? `<!doctype html><html><head><title>Empty</title></head><body><p>No links here.</p></body></html>` : links_page(port);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => server.close(resolve)));
  port = server.address().port;
  const links_url = `http://${HOST}:${port}/links`;
  const empty_url = `http://${HOST}:${port}/empty`;
  const origin = `http://${HOST}:${port}`;

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
    await sleep(500);
    expect((await session_value("desertfox_browser_module_snapshot_config"))?.value?.settings?.browser_module_pages !== true, "browser_module_pages is on");
  });

  // Presses `keys` with the clipboard on a sentinel and gives the clipboard once it changes.
  async function copied_by(keys, what) {
    await clear_notices();
    await chrome(set_clipboard(SENTINEL));
    await focus_page();
    await press_keys(...keys.split(""));
    await poll_until(what, async () => (await chrome(clipboard_text)) !== SENTINEL, { timeout_ms: 5000 });
    return chrome(clipboard_text);
  }
  const notices = async () => Object.values((await in_background(`browser.notifications.getAll()`)) ?? {}).map((notice) => notice.message);
  const links_in = (text) => text.split("\n").filter(Boolean);

  await run_case("on a restricted host yL copies the page's links as Markdown, stripped, deduped and absolute", async () => {
    try {
      await open_tab(links_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      const text = await copied_by("yL", "yL on a restricted host");
      expect(
        text === [`- [First](https://example.org/first?k=1)`, `- [Relative](${origin}/relative/path)`, `- [https://example.org/bare](https://example.org/bare)`, `- [Far below](https://example.org/far-below)`].join("\n"),
        `yL copied ${JSON.stringify(text)}`,
      );
      await poll_until("the Copied 4 links notification", async () => (await notices()).includes("Copied 4 links"), { timeout_ms: 5000 });
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("on a restricted host yl copies only the links in view", async () => {
    try {
      await open_tab(links_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      const text = await copied_by("yl", "yl on a restricted host");
      expect(links_in(text).length === 3 && !text.includes("far-below"), `yl copied ${JSON.stringify(text)}`);
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("a restricted host page with no links gives the notice and leaves the clipboard", async () => {
    try {
      await open_tab(empty_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      await clear_notices();
      await chrome(set_clipboard(SENTINEL));
      await press_keys("y", "L");
      await poll_until("the no links notification", async () => (await notices()).includes("No links on this page"), { timeout_ms: 5000 });
      expect((await chrome(clipboard_text)) === SENTINEL, "yL changed the clipboard");
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("on about:preferences yL copies web links, and yl copies no more than yL", async () => {
    try {
      await open_tab("about:preferences");
      await focus_page();
      await sleep(1000);
      const all = await copied_by("yL", "yL on about:preferences");
      const lines = links_in(all);
      expect(lines.length > 0 && lines.every((line) => /^- \[.*\]\(https?:\/\/[^\s)]+\)$/.test(line)), `yL on about:preferences copied ${JSON.stringify(all)}`);
      const in_view = await copied_by("yl", "yl on about:preferences");
      expect(links_in(in_view).length <= lines.length && links_in(in_view).every((line) => lines.includes(line)), `yl copied ${JSON.stringify(in_view)}`);
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("with browser_module_pages off yL copies the link annotations of the PDF viewer, and yl the same on its first screen", async () => {
    try {
      await open_tab(pdf_url);
      await poll_until("the PDF viewer to draw its link", () => steps.in_selected_page(`(win) => !!win.document.querySelector(".annotationLayer a[href]")`), { timeout_ms: 10000 });
      await focus_page();
      for (const keys of ["yL", "yl"]) {
        const text = await copied_by(keys, `${keys} on the PDF viewer`);
        expect(text === "- [https://example.org/from-the-pdf](https://example.org/from-the-pdf)", `${keys} copied ${JSON.stringify(text)}`);
      }
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("with browser_module_pages off yL copies the article's links from Reader View, stripped and with none to its own page", async () => {
    try {
      await open_tab(`about:reader?url=${encodeURIComponent(`${origin}/article`)}`);
      await poll_until("Reader View to draw the article", () => steps.in_selected_page(`(win) => !!win.document.querySelector(".moz-reader-content a")`), { timeout_ms: 10000 });
      await focus_page();
      const text = await copied_by("yL", "yL on Reader View");
      expect(text.includes(`(${origin}/target?k=1)`) && !text.includes("utm_source") && !text.includes("#top") && !text.includes("about:reader"), `yL copied ${JSON.stringify(text)}`);
    } finally {
      await close_selected_tab();
    }
  });

  for (const [page, open] of [["about:protections, a page in a content process", () => open_tab("about:protections")]]) {
    await run_case(`on ${page} yL and yl give the notice and copy nothing`, async () => {
      try {
        await open();
        await focus_page();
        await sleep(500);
        for (const keys of ["yL", "yl"]) {
          await clear_notices();
          await chrome(set_clipboard(SENTINEL));
          await focus_page();
          await press_keys(...keys.split(""));
          await poll_until(`the refusal for ${keys} on ${page}`, async () => (await notices()).includes(NO_LINKS_HERE), { timeout_ms: 5000 });
          await sleep(NO_EFFECT_MS);
          expect((await chrome(clipboard_text)) === SENTINEL, `${keys} on ${page} changed the clipboard`);
        }
      } finally {
        await close_selected_tab();
      }
    });
  }

  await run_case("with browser_module_pages on yL on the PDF viewer still copies through the page code", async () => {
    try {
      await run_line(":set browser_module_pages true");
      await poll_until("the config snapshot with the setting on", async () => (await session_value("desertfox_browser_module_snapshot_config"))?.value?.settings?.browser_module_pages === true);
      await open_tab(pdf_url);
      await focus_page();
      await sleep(1500);
      const text = await copied_by("yL", "yL on the PDF viewer with page code");
      expect(text.includes("https://example.org/from-the-pdf"), `yL copied ${JSON.stringify(text)}`);
    } finally {
      await close_selected_tab();
      await run_line(":set browser_module_pages false");
    }
  });
}
