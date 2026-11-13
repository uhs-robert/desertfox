// One tool alone in a fresh profile, over the pages. Run by rivals.mjs, which sets RIVALS_DIR, PASS and PAGES.
// usage: node run.mjs <config> [runs]
import { connect_rdp, install_temporary_addon, evaluate_in_chrome } from "../../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { page_body } from "./pages.mjs";

const cfg = process.argv[2];
const RUNS = Number(process.argv[3] ?? 7);
const REPO = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const WORK = process.env.RIVALS_DIR;
const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const EXT = {
  none: null,
  desertfox: { path: `${REPO}/dist`, id: "desertfox@uhs-robert" },
  vimium: { path: `${WORK}/xpi/vimium-ff/vimium-ff.xpi`, id: "{d7742d87-e61d-4b78-b8a1-b469842139fa}" },
  vimiumc: { path: `${WORK}/xpi/vimium-c/vimium-c.xpi`, id: "vimium-c@gdh1995.cn" },
  tridactyl: { path: `${WORK}/xpi/tridactyl/tridactyl.xpi`, id: "tridactyl.vim@cmcaine.co.uk" },
}[cfg];
const profile = `${WORK}/profiles/${cfg}`;
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
writeFileSync(`${profile}/user.js`, readFileSync(`${REPO}/test/key/user.js`, "utf8") + `\nuser_pref("privacy.reduceTimerPrecision", false);\nuser_pref("extensions.webextensions.warnings-as-errors", false);\n`);

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const name = url.pathname.slice(1) || "none";
  const body = page_body(name, url);
  res.writeHead(body === null ? 404 : 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body ?? "");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const debug_port = 6900 + Math.floor(Math.random() * 400);
const ff = spawn("firefox", ["--headless", "-no-remote", "-profile", profile, "-start-debugger-server", String(debug_port), "about:blank"], { stdio: "ignore" });
let rdp;
for (let i = 0; i < 120; i++) { try { rdp = await connect_rdp(debug_port); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = (code) => evaluate_in_chrome(rdp, code);
const BR = `Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser`;
let slot_n = 0;
// rdp gives an evaluation 5 s; long jobs store their result in a chrome global and node polls for it.
const chrome_long = async (async_code, limit_ms) => {
  const slot = `__pb_${++slot_n}`;
  await chrome(`(globalThis.${slot} = undefined, (async () => ${async_code})().then((v) => { globalThis.${slot} = JSON.stringify(v ?? null); }, (e) => { globalThis.${slot} = JSON.stringify({ error: String(e) }); }), 1)`);
  const deadline = Date.now() + limit_ms;
  while (Date.now() < deadline) { await sleep(150); const v = await chrome(`globalThis.${slot} ?? null`); if (typeof v === "string") { await chrome(`(delete globalThis.${slot}, 1)`); return JSON.parse(v); } }
  throw new Error("long job timeout");
};
const navigate = (url) => chrome(`(async () => { const w = Services.wm.getMostRecentWindow("navigator:browser"); w.gBrowser.selectedBrowser.fixupAndLoadURIString(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); return 1; })()`);
const FS_URL = "data:application/javascript;charset=utf-8," + encodeURIComponent(readFileSync(`${SCRIPT_DIR}framescript.js`, "utf8"));
const load_fs = () => chrome(`(async () => { ${BR}.messageManager.loadFrameScript(${JSON.stringify(FS_URL)}, false); return 1; })()`);
const call = (name, data = {}, ms = 2000) => chrome_long(`{ const mm = ${BR}.messageManager; return await new Promise((res) => { const l = (m) => { mm.removeMessageListener("pb:reply", l); res(m.data); }; mm.addMessageListener("pb:reply", l); mm.sendAsyncMessage("pb:${name}", ${JSON.stringify(data)}); }); }`, ms);
const memory = async () => {
  await chrome(`(Services.obs.notifyObservers(null, "child-mmu-request"), 1)`);
  await sleep(2500);
  return chrome_long(`{
    const pid = ${BR}.browsingContext.currentWindowGlobal.domProcess.osPid;
    const info = await ChromeUtils.requestProcInfo();
    const content = info.children.find((c) => c.pid === pid);
    const ext = info.children.filter((c) => c.type === "extension");
    const heap = await new Promise((resolve) => { const mgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager); const out = { content_ext_heap: 0, ext_proc_heap: 0, ext_proc_explicit: 0 };
      mgr.getReports((process, path, kind, units, amount) => { if (units !== 0 || !path.startsWith("explicit/")) return; if (path.includes("moz-extension")) (out.seen ??= {})[process.replace(/\d+/g, "N")] = 1;
        if (process.includes(" " + pid + ")") && !process.startsWith("extension") && path.includes("moz-extension")) out.content_ext_heap += amount;
        if (process.startsWith("extension") && path.includes("moz-extension")) out.ext_proc_heap += amount;
        if (process.startsWith("extension") && path.split("/").length === 2) out.ext_proc_explicit += amount; }, null, () => resolve(out), null, false); });
    return { seen: heap.seen, content_rss: content ? content.memory : null, ext_rss: ext.reduce((s, c) => s + c.memory, 0), ext_procs: ext.length, ...heap };
  }`, 30000);
};
const out = { cfg, base, firefox: "", meta: {}, runs: [] };
const log = (o) => console.log(JSON.stringify(o));
try {
  out.firefox = await chrome(`Services.appinfo.version`);
  for (let i = 0; i < 60; i++) { const ok = await chrome(`!!Services.wm.getMostRecentWindow("navigator:browser")?.gBrowser?.selectedBrowser`); if (ok === true) break; await sleep(500); }
  await sleep(1000);
  // A system policy (/etc/firefox/policies) force-installs the release DesertFox from GitHub into every profile. Remove it before anything else.
  for (let i = 0; i < 40; i++) {
    const gone = await chrome_long(`{ const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"); const a = await AddonManager.getAddonByID("desertfox@uhs-robert"); if (a && a.permanentInstall !== false && !a.temporarilyInstalled) { await a.uninstall(); return "removed"; } return a ? "temp" : "absent"; }`, 8000);
    out.meta.policy_ext = gone; if (gone === "removed") break; if (i >= 12 && gone === "absent") break; await sleep(500);
  }
  await sleep(1000);
  await chrome(`(async () => { ${BR}.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(${JSON.stringify(readFileSync(`${SCRIPT_DIR}framescript.js`, "utf8"))}), true); return 1; })()`);
  if (EXT) {
    const t = Date.now();
    await install_temporary_addon(rdp, EXT.path);
    out.meta.install_ms = Date.now() - t;
    await sleep(8000);
    out.meta.perm = await chrome(`(async () => { const p = WebExtensionPolicy.getByID(${JSON.stringify(EXT.id)}); return p ? { mv: p.manifestVersion, active: p.active, host_all: p.allowedOrigins.matches("http://127.0.0.1/") } : null; })()`);
    // close tabs the extension opened (options, welcome pages) and refocus the first
    await chrome(`(async () => { const g = Services.wm.getMostRecentWindow("navigator:browser").gBrowser; while (g.tabs.length > 1) g.removeTab(g.tabs[g.tabs.length - 1]); g.selectedTab = g.tabs[0]; return 1; })()`);
    await sleep(500);
  }
  log(out.meta);
  const pages = (process.env.PAGES ?? "large,wiki,frames,frames0").split(",");
  for (const page of pages) for (let run = -1; run < RUNS; run++) {
    await navigate("about:blank"); await sleep(700);
    await navigate(`${base}/${page}`);
    let st = null;
    for (let i = 0; i < 150; i++) { await sleep(100); try { await load_fs(); st = await call("state", {}, 1500); } catch (e) { continue; }  if (st && st.ready === "complete" && st.load > 0 && st.url.startsWith(base)) break; }
    if (!st || !(st.load > 0)) { out.runs.push({ page, run, error: "not loaded", st }); continue; }
    await sleep(1500);
    await chrome(`(async () => { ${BR}.focus(); return 1; })()`);
    const rec = { page, run, dcl: st.dcl, load: st.load, elements: st.elements, focus: st.focus };
    rec.mem_load = await memory();
    if (page !== "frames0") {
      if (!EXT) { await sleep(1000); rec.mem_hints = await memory(); out.runs.push(rec); continue; }
      rec.press1 = await call("press", { char: "f", timeout_ms: 8000, settle_ms: 600 }, 20000);
      await sleep(1500);
      rec.mem_hints = await memory();
      await call("escape"); await sleep(600);
      rec.press2 = await call("press", { char: "f", timeout_ms: 8000, settle_ms: 600 }, 20000);
      await call("escape"); await sleep(400);
    }
    out.runs.push(rec);
    log({ page, run, dcl: rec.dcl, load: rec.load, p1: rec.press1?.first_ms, paint: rec.press1?.paint_ms, n: rec.press1?.count, p2: rec.press2?.first_ms, rss: rec.mem_load.content_rss, ext: rec.mem_load.ext_rss });
  }
} catch (error) { out.error = String(error.stack ?? error); console.log("ERR", out.error); process.exitCode = 1; }
finally { try { rdp.close(); } catch {} ff.kill("SIGTERM"); server.close(); }
writeFileSync(`${WORK}/out/${cfg}.p${process.env.PASS ?? 0}.json`, JSON.stringify(out, null, 1));
setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
