import { connect_rdp, install_temporary_addon, evaluate_in_background, evaluate_in_chrome } from "../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
const ID = "desertfox@uhs-robert";
const root = `${work}/frames/run`;
rmSync(root, { recursive: true, force: true });
mkdirSync(`${root}/profile`, { recursive: true });
writeFileSync(`${root}/profile/user.js`, readFileSync(`${repo}/test/key/user.js`, "utf8") + `\nuser_pref("privacy.reduceTimerPrecision", false);\n`);
const N = 200;
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  if (url.pathname === "/frame") return res.end("<!doctype html><p>frame</p>");
  const kind = url.searchParams.get("kind");
  let body = "<!doctype html><title>frames</title><p>top</p>";
  for (let i = 0; i < N; i++) body += kind === "same" ? `<iframe src="/frame?i=${i}"></iframe>` : kind === "sandbox" ? `<iframe sandbox="allow-scripts" src="/frame?i=${i}"></iframe>` : kind === "blank" ? `<iframe></iframe>` : "";
  res.end(body + `<script>addEventListener("load",()=>{document.title="loaded "+performance.now().toFixed(0)})</script>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const debug_port = 6400 + Math.floor(Math.random() * 500);
const ff = spawn("firefox", ["--headless", "-no-remote", "-profile", `${root}/profile`, "-start-debugger-server", String(debug_port), "about:blank"], { stdio: "ignore" });
let rdp;
for (let i = 0; i < 80; i++) { try { rdp = await connect_rdp(debug_port); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = (code) => evaluate_in_chrome(rdp, code);
const navigate = (url) => chrome(`(async () => { const w = Services.wm.getMostRecentWindow("navigator:browser"); w.gBrowser.selectedBrowser.fixupAndLoadURIString(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); return 1; })()`);
const title = () => chrome(`Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.contentTitle`);
const memory = async () => {
  await chrome(`(Services.obs.notifyObservers(null, "child-mmu-request"), 1)`);
  await sleep(2500);
  return chrome(`(async () => { const info = await ChromeUtils.requestProcInfo(); return info.children.filter((c) => /web|file|isolated/i.test(c.type)).reduce((sum, c) => sum + c.memory, 0); })()`);
};
const out = [];
try {
  for (const ext of ["none", "desertfox"]) {
    if (ext === "desertfox") { await install_temporary_addon(rdp, `${repo}/dist`); await sleep(3000);
      await evaluate_in_background(rdp, ID, `(() => { globalThis.__n = {}; browser.runtime.onMessage.addListener((m) => { __n[m?.type] = (__n[m?.type] ?? 0) + 1; }); return 1; })()`); }
    for (const round of [1, 2]) for (const kind of ["none", "same", "sandbox", "blank"]) {
      await navigate("about:blank"); await sleep(800);
      if (ext === "desertfox") await evaluate_in_background(rdp, ID, `(() => { for (const k in __n) delete __n[k]; return 1; })()`);
      await navigate(`${base}/?kind=${kind}`);
      let t = ""; for (let i = 0; i < 100 && !t.startsWith("loaded"); i++) { await sleep(100); t = await title(); }
      if (!t.startsWith("loaded")) throw new Error(`page did not load: ${kind}`);
      await sleep(1500);
      const mem = await memory();
      const msgs = ext === "desertfox" ? await evaluate_in_background(rdp, ID, `__n`) : {};
      out.push({ ext, round, kind, load_ms: Number(t.split(" ")[1]), mem_mb: +(mem / 1048576).toFixed(1), msgs });
      console.log(JSON.stringify(out.at(-1)));
    }
  }
} catch (error) { console.log("ERR", String(error.stack ?? error)); process.exitCode = 1; }
finally { try { rdp.close(); } catch {} ff.kill("SIGTERM"); server.close(); }
writeFileSync(`${work}/frames/result.json`, JSON.stringify(out, null, 1));
setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
