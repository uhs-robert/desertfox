// DesertFox's own page code in the PDF viewer and Reader View, which the browser module runs there (browser_module/desertfox-locked-pages.js) while the setting browser_module_pages is on.
// Hints and a pick, visual mode and a yank, what a page script can see, the setting off, another protocol version, a navigation away and back, and about:addons, which never gets page code.
// DESERTFOX_SHOT_DIR also takes shots of the hints on both pages in a light and a dark theme.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { make_article, module_steps } from "./browser_module_steps.mjs";

export const areas = ["hints", "caret", "bundles", "ui"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;
const CONFIG_SNAPSHOT_KEY = "desertfox_browser_module_snapshot_config";
const SANDBOX_NAME = "DesertFox page code";

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

// The labels in the hint layer's closed shadow root, each with where it sits.
const HINT_LABELS = `(win) => {
  const host = [...win.document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}");
  const root = host?.openOrClosedShadowRoot;
  return root ? [...root.querySelectorAll(".desertfox-hint")].map((label) => { const box = label.getBoundingClientRect(); return { text: label.textContent, x: box.left, y: box.top }; }) : [];
}`;
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
// What the page's own scripts see of the window: its own properties, through no Xray.
const PAGE_SEES = `(win) => {
  const page = win.wrappedJSObject;
  return { names: Object.getOwnPropertyNames(page).filter((name) => /desertfox|^browser$|locked_transport/.test(name)), host: typeof page.desertfox_host, transport: typeof page.desertfox_locked_transport, browser: typeof page.browser };
}`;
const MODE = `(win) => win.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? [...win.document.documentElement.children].map((child) => child.getAttribute("data-desertfox-mode")).find(Boolean) ?? null`;

// A PDF with a text line and a link annotation to `href`, which pdf.js draws as a link in its annotation layer.
function make_linked_pdf(href) {
  const text = "BT /F1 18 Tf 72 700 Td (The desert fox walks at night across the dunes) Tj ET\nBT /F1 18 Tf 72 640 Td (Follow the link below) Tj ET\nBT /F1 18 Tf 72 600 Td (The target link) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    `<< /Type /Annot /Subtype /Link /Rect [70 590 300 620] /Border [0 0 0] /A << /S /URI /URI (${href}) >> >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

// The long article Reader View takes, with one link to pick.
const linked_article = () => make_article().replace("</article>", `<p>The end: <a href="/target">the target link</a>.</p></article>`);

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, run_line, take_shot } = context;
  const steps = module_steps(context);
  const { chrome, open_tab, focus_page, in_selected_page, close_selected_tab, home, selected_spec, set_session_value, session_value } = steps;
  const server = createServer((request, response) => {
    if (request.url === "/linked.pdf") return response.writeHead(200, { "content-type": "application/pdf" }).end(make_linked_pdf(`${origin}/target`), "latin1");
    if (request.url === "/article") return response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(linked_article());
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>${request.url}</title><p>${request.url}</p>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.on_teardown(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-page-code-"));
  writeFileSync(join(files_dir, "linked.pdf"), make_linked_pdf(`${origin}/target`), "latin1");
  const pages = {
    "the PDF viewer": { url: pathToFileURL(join(files_dir, "linked.pdf")).href, ready: `(win) => !!win.document.querySelector(".annotationLayer a[href]") && !!win.document.querySelector(".textLayer span")` },
    "Reader View": { url: `about:reader?url=${encodeURIComponent(`${origin}/article`)}`, ready: `(win) => !!win.document.querySelector('.moz-reader-content a[href$="/target"]')` },
  };

  const page_code_ran = () => in_selected_page(`(win) => win.document.documentElement?.hasAttribute("data-desertfox-tree-read-ms") ?? false`);
  const hint_labels = () => in_selected_page(HINT_LABELS);
  const listeners = () => in_selected_page(PAGE_CODE_LISTENERS);
  // The page code's realms in every process, after a collection, so a realm that is only waiting for one does not count.
  const page_code_realms = () =>
    chrome(`(async () => {
      const manager = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
      await new Promise((resolve) => manager.minimizeMemoryUsage(resolve));
      const realms = new Set();
      await new Promise((resolve) => manager.getReports((process, path) => { if (path.startsWith("js-main-runtime-realms/") && path.endsWith("${SANDBOX_NAME}")) realms.add(process + " " + path); }, null, resolve, null, false));
      return [...realms];
    })()`);

  async function open_locked(name) {
    await open_tab(pages[name].url);
    await poll_until(`${name} to draw`, () => in_selected_page(pages[name].ready), { timeout_ms: 10000 });
    await poll_until(`the page code to start on ${name}`, async () => (await page_code_ran()) && (await listeners()) > 0, { timeout_ms: 8000 });
    await focus_page();
  }

  // Types the label of the hint that sits nearest the element `selector` names.
  async function pick_hint_at(selector, what) {
    await in_selected_page(`(win) => { win.document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" }); return true; }`);
    await sleep(200);
    await press_keys("f");
    await poll_until(`hint labels for ${what}`, async () => (await hint_labels()).length > 0, { timeout_ms: 5000 });
    const labels = await hint_labels();
    const target = await in_selected_page(`(win) => { const box = win.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: box.left, y: box.top }; }`);
    const nearest = labels.reduce((best, label) => (Math.hypot(label.x - target.x, label.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y) ? label : best));
    await press_keys(nearest.text);
  }

  await setup("turn the module and the page code on", async () => {
    await steps.turn_on_module();
    await run_line(":set browser_module_pages true");
    await poll_until("the config snapshot with the setting on", async () => (await session_value(CONFIG_SNAPSHOT_KEY))?.value?.settings?.browser_module_pages === true);
  });

  for (const [name, selector] of [
    ["the PDF viewer", ".annotationLayer a[href]"],
    ["Reader View", '.moz-reader-content a[href$="/target"]'],
  ]) {
    await run_case(`f shows labels on ${name}, and picking a link's label follows it`, async () => {
      await home(`pc_hints_${name.replace(/\W+/g, "_")}`);
      await open_locked(name);
      await pick_hint_at(selector, name);
      await poll_until(`the pick on ${name} to follow the link`, async () => (await selected_spec()) === `${origin}/target`, { timeout_ms: 5000 });
      await close_selected_tab();
    });

    await run_case(`v v w y on ${name} copies the page's text`, async () => {
      await home(`pc_yank_${name.replace(/\W+/g, "_")}`);
      await open_locked(name);
      await chrome(set_clipboard("before the yank"));
      // v starts caret mode, and v there starts visual mode.
      await press_keys("v");
      await poll_until(`caret mode on ${name}`, async () => /caret/i.test(String(await in_selected_page(MODE))), { timeout_ms: 5000 });
      await press_keys("v");
      await poll_until(`visual mode on ${name}`, async () => /visual/i.test(String(await in_selected_page(MODE))), { timeout_ms: 5000 });
      await press_keys("w");
      await sleep(150);
      await press_keys("y");
      await poll_until(`the yank on ${name}`, async () => !["", "before the yank"].includes(await chrome(clipboard_text)), { timeout_ms: 5000 });
      const copied = (await chrome(clipboard_text)).trim();
      const shown = await in_selected_page(`(win) => win.document.body.textContent.includes(${JSON.stringify(copied.split(/\s+/)[0])})`);
      console.log(`${name} yank copied ${JSON.stringify(copied.slice(0, 60))}`);
      expect(copied.length > 0 && shown, `the yank on ${name} copied ${JSON.stringify(copied)}, which the page does not show`);
      await close_selected_tab();
    });

    await run_case(`a page script on ${name} sees neither desertfox_host, the transport nor the sandbox's browser`, async () => {
      await home(`pc_hidden_${name.replace(/\W+/g, "_")}`);
      await open_locked(name);
      // A bundle loads too, so its globals are there to leak.
      await press_keys("f");
      await poll_until("hint labels", async () => (await hint_labels()).length > 0, { timeout_ms: 5000 });
      await press_keys("-k", "Escape");
      const seen = await in_selected_page(PAGE_SEES);
      expect(seen.names.length === 0 && seen.host === "undefined" && seen.transport === "undefined" && seen.browser === "undefined", `the page sees ${JSON.stringify(seen)}`);
      await close_selected_tab();
    });
  }

  await run_case("keys still work on the PDF viewer after Firefox's second load event for it", async () => {
    await home("pc_pdf_late");
    await open_locked("the PDF viewer");
    // Firefox reports the PDF loading a second time about 120 ms after its document loads, and complete again about a second later. Neither is a new document.
    await sleep(1500);
    await press_keys("f");
    await poll_until("hint labels 1.5 s after the load", async () => (await hint_labels()).length > 0, { timeout_ms: 5000 });
    await press_keys("-k", "Escape");
    await poll_until("the labels to go", async () => (await hint_labels()).length === 0, { timeout_ms: 3000 });
    await close_selected_tab();
  });

  await run_case("navigating away from the PDF viewer and back leaves one page code and no realm behind", async () => {
    await home("pc_leak");
    await open_locked("the PDF viewer");
    const listeners_first = await listeners();
    console.log(`realms after the first load: ${JSON.stringify(await page_code_realms())}`);
    await chrome(`(async () => { const b = ${W}.gBrowser.selectedBrowser; b.loadURI(Services.io.newURI("${origin}/away"), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); })()`);
    await steps.wait_loaded((spec) => spec.endsWith("/away"));
    console.log(`realms away: ${JSON.stringify(await page_code_realms())}`);
    await chrome(`(async () => ${W}.gBrowser.selectedBrowser.goBack())()`);
    await poll_until("the PDF viewer again", () => in_selected_page(pages["the PDF viewer"].ready), { timeout_ms: 10000 });
    await poll_until("the page code again", async () => (await listeners()) > 0, { timeout_ms: 8000 });
    expect((await listeners()) === listeners_first, `the page code listens ${await listeners()} times after Back, ${listeners_first} before`);
    const back_realms = await page_code_realms();
    expect(back_realms.length === 1, `after Back the page code has ${back_realms.length} realms: ${back_realms.join("; ")}`);
    await focus_page();
    await press_keys("f");
    await poll_until("hint labels after Back", async () => (await hint_labels()).length > 0, { timeout_ms: 5000 });
    expect((await in_selected_page(`(win) => [...win.document.documentElement.children].filter((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}").length`)) === 1, "Back left two hint layers");
    await press_keys("-k", "Escape");
    await close_selected_tab();
    await poll_until("no page code realm once the tab closed", async () => (await page_code_realms()).length === 0, { timeout_ms: 8000 });
  });

  await run_case("about:addons gets no page code", async () => {
    await home("pc_addons");
    await open_tab("about:addons");
    await poll_until("about:addons to load", () => in_selected_page(`(win) => win.document.readyState === "complete"`));
    await sleep(1500);
    expect((await page_code_ran()) === false, "about:addons ran DesertFox's page code");
    expect((await listeners()) === 0, "DesertFox listens on about:addons");
    const seen = await in_selected_page(`(win) => Object.getOwnPropertyNames(win).filter((name) => /desertfox/.test(name))`);
    expect(seen.length === 0, `about:addons holds ${seen.join(", ")}`);
    await close_selected_tab();
  });

  // Each check waits this long for page code that must not come: an attach takes about 50 ms.
  const expect_no_page_code = async (what) => {
    await sleep(1500);
    expect((await page_code_ran()) === false && (await listeners()) === 0, `${what} still ran page code`);
  };

  await run_case("another protocol version in the config snapshot loads nothing", async () => {
    await home("pc_version");
    const snapshot = await session_value(CONFIG_SNAPSHOT_KEY);
    context.on_teardown(() => set_session_value(CONFIG_SNAPSHOT_KEY, snapshot));
    await set_session_value(CONFIG_SNAPSHOT_KEY, { ...snapshot, v: snapshot.v + 1 });
    await open_tab(pages["the PDF viewer"].url);
    await poll_until("the PDF viewer to draw", () => in_selected_page(pages["the PDF viewer"].ready), { timeout_ms: 10000 });
    await expect_no_page_code("a config snapshot of another version");
    await close_selected_tab();
    await set_session_value(CONFIG_SNAPSHOT_KEY, snapshot);
  });

  await run_case("with browser_module_pages off, nothing loads on the PDF viewer or Reader View", async () => {
    await home("pc_off");
    await run_line(":set browser_module_pages false");
    try {
      await poll_until("the snapshots to go", async () => (await session_value(CONFIG_SNAPSHOT_KEY)) === null);
      for (const name of Object.keys(pages)) {
        await open_tab(pages[name].url);
        await poll_until(`${name} to draw`, () => in_selected_page(pages[name].ready), { timeout_ms: 10000 });
        await expect_no_page_code(`${name} with the setting off`);
        await close_selected_tab();
      }
    } finally {
      // The command line opens from a DesertFox page.
      await home("pc_on_again");
      await run_line(":set browser_module_pages true");
      await poll_until("the config snapshot with the setting on", async () => (await session_value(CONFIG_SNAPSHOT_KEY))?.value?.settings?.browser_module_pages === true);
    }
  });

  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  if (shot_dir) {
    for (const scheme of ["light", "dark"]) {
      for (const name of Object.keys(pages)) {
        await run_case(`shot of the hints on ${name} in the ${scheme} theme`, async () => {
          await home(`pc_shot_${scheme}_${name.replace(/\W+/g, "_")}`);
          await chrome(`(async () => { Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", ${scheme === "dark" ? 0 : 1}); Services.prefs.setCharPref("reader.color_scheme", "${scheme}"); Services.prefs.setIntPref("pdfjs.viewerCssTheme", ${scheme === "dark" ? 2 : 1}); })()`);
          context.on_teardown(() => chrome(`(async () => { for (const pref of ["layout.css.prefers-color-scheme.content-override", "reader.color_scheme", "pdfjs.viewerCssTheme"]) Services.prefs.clearUserPref(pref); })()`));
          await open_locked(name);
          await press_keys("f");
          await poll_until("hint labels", async () => (await hint_labels()).length > 0, { timeout_ms: 5000 });
          await sleep(300);
          await take_shot(join(shot_dir, `page-code-${name.replace(/\W+/g, "-").toLowerCase()}-${scheme}.png`));
          await press_keys("-k", "Escape");
          await close_selected_tab();
        });
      }
    }
  }
}
