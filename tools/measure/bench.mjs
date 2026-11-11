import { connect_rdp, install_temporary_addon, evaluate_in_chrome } from "../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";

const root = `${work}/bench/run`;
rmSync(root, { recursive: true, force: true });
mkdirSync(`${root}/profile`, { recursive: true });
mkdirSync(`${root}/files`, { recursive: true });
const base_prefs = readFileSync(`${repo}/test/key/user.js`, "utf8");
writeFileSync(`${root}/profile/user.js`, base_prefs + `
user_pref("privacy.reduceTimerPrecision", false);
user_pref("privacy.resistFingerprinting", false);
user_pref("xpinstall.signatures.required", false);
`);
const real = readFileSync(`${repo}/dist/content.js`, "utf8");
// eager pad: every function is called once, so every byte is fully compiled and run.
function eager_pad(bytes) {
  let out = "var __acc=0;";
  for (let i = 0; out.length < bytes; i++) out += `function f${i}(a,b){const o={x:a,y:b,z:[a,b,${i}]};if(o.z.length>2){return o.x+o.y+o.z[2]}return 0}__acc+=f${i}(1,2);`;
  return out;
}
// lazy pad: real DesertFox code inside functions that are never called (syntax parse only).
function lazy_pad(bytes) {
  let out = "";
  for (let i = 0; out.length < bytes; i++) out += `function pad${i}(){${real}}\n`;
  return out;
}
const sizes_kb = [0, 4, 8, 16, 32, 64, 128, 256, 1024];
const variants = [];
for (const kind of ["eager", "lazy"]) for (const kb of sizes_kb) {
  if (kind === "lazy" && kb === 0) continue;
  const pad = kb === 0 ? "" : (kind === "eager" ? eager_pad(kb * 1024) : lazy_pad(kb * 1024));
  variants.push({ name: `${kind}_${kb}`, kind, kb, pad, bytes: pad.length });
  writeFileSync(`${root}/files/${kind}_${kb}.js`, pad || "void 0;");
}
writeFileSync(`${root}/files/real.js`, real);

const reports = [];
let on_report = () => {};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/report") {
    reports.push(Object.fromEntries(url.searchParams));
    res.writeHead(204, { "access-control-allow-origin": "*" }); res.end(); on_report();
    return;
  }
  if (url.pathname === "/frame") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end("<!doctype html><p>frame</p>"); return; }
  const n = Number(url.searchParams.get("n") ?? 0), max = Number(url.searchParams.get("max") ?? 0), frames = Number(url.searchParams.get("frames") ?? 0);
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  let body = `<!doctype html><title>t</title><p>page ${n}</p>`;
  for (let i = 0; i < frames; i++) body += `<iframe src="/frame?i=${i}"></iframe>`;
  body += `<script>addEventListener("load",()=>setTimeout(()=>{ fetch("/report?kind=load&n=${n}&load_ms="+(performance.now())).then(()=>{ if(${n}<${max}) location.href="/?n=${n + 1}&max=${max}&frames=${frames}"; }) },30));</script>`;
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const debug_port = 6400 + Math.floor(Math.random() * 500);
const ff = spawn("firefox", ["--headless", "-no-remote", "-profile", `${root}/profile`, "-start-debugger-server", String(debug_port), "about:blank"], { stdio: "ignore" });
let rdp;
for (let i = 0; i < 80; i++) { try { rdp = await connect_rdp(debug_port); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
if (!rdp) throw new Error("no rdp");
const out = { firefox: null, micro: [], e2e: [], memory: [] };
try {
  out.firefox = await evaluate_in_chrome(rdp, `Services.appinfo.version`);
  // A: micro benchmark in the parent process with the API the content script loader uses.
  for (const file of ["real", ...variants.map((v) => v.name)]) {
    const r = await evaluate_in_chrome(rdp, `(async () => {
      const url = "file://${root}/files/${file}.js";
      const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin("http://example.com");
      const compile = [], exec = [], sandbox = [];
      let script;
      const runs = 15;
      for (let i = 0; i < runs; i++) {
        const t0 = Cu.now(); script = await ChromeUtils.compileScript(url, { hasReturnValue: false }); compile.push(Cu.now() - t0);
      }
      for (let i = 0; i < runs; i++) {
        const t1 = Cu.now(); const sb = Cu.Sandbox(principal, { wantXrays: true }); const t2 = Cu.now();
        try { script.executeInGlobal(sb); } catch (e) {}
        exec.push(Cu.now() - t2); sandbox.push(t2 - t1); Cu.nukeSandbox(sb);
      }
      return { compile_ms: med(compile), compile_min: Math.min(...compile), exec_ms: med(exec), exec_first: exec[0], sandbox_ms: med(sandbox) };
    })()`);
    out.micro.push({ file, bytes: readFileSync(`${root}/files/${file}.js`).length, ...r });
  }
  // Memory: 200 sandboxes, each runs the script, all kept alive.
  for (const file of ["eager_0", "eager_4", "eager_16", "eager_32", "eager_64", "eager_256", "lazy_16", "lazy_64", "lazy_256"]) {
    const r = await evaluate_in_chrome(rdp, `(async () => {
      const url = "file://${root}/files/${file}.js";
      const mgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
      const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin("http://example.com");
      const script = await ChromeUtils.compileScript(url, { hasReturnValue: false });
      const gc = () => { for (let i = 0; i < 3; i++) { Cu.forceGC(); Cu.forceCC(); } };
      const used = () => mgr.JSMainRuntimeGCHeap + mgr.heapAllocated;
      gc(); const before = used(); const before_gc = mgr.JSMainRuntimeGCHeap;
      const keep = [];
      for (let i = 0; i < 200; i++) { const sb = Cu.Sandbox(principal, { wantXrays: true }); script.executeInGlobal(sb); keep.push(sb); }
      gc(); const after = used(); const after_gc = mgr.JSMainRuntimeGCHeap;
      for (const sb of keep) Cu.nukeSandbox(sb); keep.length = 0; gc();
      return { per_sandbox_bytes: Math.round((after - before) / 200), gc_heap_per_sandbox: Math.round((after_gc - before_gc) / 200) };
    })()`);
    out.memory.push({ file, ...r });
  }
  // B: end to end. The probe add-on's content script reports when its listener is attached.
  const navigate = (url) => evaluate_in_chrome(rdp, `(async () => { const w = Services.wm.getMostRecentWindow("navigator:browser"); w.gBrowser.selectedBrowser.fixupAndLoadURIString(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); return 1; })()`);
  const e2e_variants = variants.filter((v) => [0, 4, 16, 32, 64, 256, 1024].includes(v.kb));
  const loads = 25;
  for (const pass of [1, 2]) for (const v of e2e_variants) for (const frames of pass === 1 ? [0, 20] : [0]) {
    const dir = `${root}/ext_${v.name}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/manifest.json`, JSON.stringify({ manifest_version: 2, name: "probe", version: "1", browser_specific_settings: { gecko: { id: "probe@example.invalid" } }, permissions: ["<all_urls>"], content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"], run_at: "document_start", all_frames: true, match_about_blank: true }] }));
    writeFileSync(`${dir}/content.js`, `(()=>{const t0=performance.now();${v.pad};addEventListener("keydown",()=>{},true);const t1=performance.now();if(window.top!==window||!location.search.includes("n="))return;const nav=performance.timing;const q=new URLSearchParams(location.search);fetch("http://127.0.0.1:${port}/report?kind=cs&n="+q.get("n")+"&t0="+t0+"&t1="+t1+"&rs="+(nav.responseStart-nav.navigationStart)+"&readyState="+document.readyState);})();`);
    await install_temporary_addon(rdp, dir);
    reports.length = 0;
    const done = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`timeout ${v.name} ${frames}`)), 60000); on_report = () => { if (reports.filter((r) => r.kind === "load").length > loads) { clearTimeout(timer); resolve(); } }; });
    await navigate(`http://127.0.0.1:${port}/?n=0&max=${loads}&frames=${frames}`);
    await done;
    const cs = reports.filter((r) => r.kind === "cs").map((r) => ({ n: +r.n, t0: +r.t0, t1: +r.t1, rs: +r.rs }));
    const ld = reports.filter((r) => r.kind === "load").map((r) => ({ n: +r.n, load: +r.load_ms }));
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const warm = cs.filter((r) => r.n > 0);
    const first = cs.find((r) => r.n === 0);
    out.e2e.push({ variant: v.name, bytes: v.bytes, frames, pass, samples: warm.length,
      first_ready_after_nav: first && +first.t1.toFixed(2), first_exec: first && +(first.t1 - first.t0).toFixed(2),
      ready_after_nav_med: +med(warm.map((r) => r.t1)).toFixed(2), ready_after_response_med: +med(warm.map((r) => r.t1 - r.rs)).toFixed(2),
      exec_med: +med(warm.map((r) => r.t1 - r.t0)).toFixed(3), load_event_med: +med(ld.filter((r) => r.n > 0).map((r) => r.load)).toFixed(1) });
  }
} catch (error) { out.error = String(error.stack ?? error); }
finally { try { rdp.close(); } catch {} ff.kill("SIGTERM"); server.close(); }
writeFileSync(`${work}/bench/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
setTimeout(() => process.exit(0), 1500);
