import { connect_rdp, evaluate_in_chrome } from "../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
const root = `${work}/bench/run`;
const debug_port = 6400 + Math.floor(Math.random() * 500);
const ff = spawn("firefox", ["--headless", "-no-remote", "-profile", `${root}/profile`, "-start-debugger-server", String(debug_port), "about:blank"], { stdio: "ignore" });
let rdp;
for (let i = 0; i < 80; i++) { try { rdp = await connect_rdp(debug_port); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const out = { micro: [], memory: [] };
try {
  const files = ["real", "eager_0", "eager_4", "eager_8", "eager_16", "eager_32", "eager_64", "eager_128", "eager_256", "eager_1024", "lazy_16", "lazy_32", "lazy_64", "lazy_256", "lazy_1024"];
  for (const file of files) {
    const r = await evaluate_in_chrome(rdp, `(async () => {
      const url = "file://${root}/files/${file}.js";
      const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin("http://example.com");
      const compile = [], exec = [], sandbox = [];
      let script;
      for (let i = 0; i < 9; i++) { const t0 = ChromeUtils.now(); script = await ChromeUtils.compileScript(url, { hasReturnValue: false }); compile.push(ChromeUtils.now() - t0); }
      let err = "";
      for (let i = 0; i < 9; i++) {
        const t1 = ChromeUtils.now(); const sb = Cu.Sandbox(principal, { wantXrays: true }); const t2 = ChromeUtils.now();
        try { script.executeInGlobal(sb); } catch (e) { err = String(e).slice(0, 80); }
        exec.push(ChromeUtils.now() - t2); sandbox.push(t2 - t1); Cu.nukeSandbox(sb);
      }
      return { compile_ms: med(compile), compile_min: Math.min(...compile), exec_ms: med(exec), sandbox_ms: med(sandbox), err };
    })()`).catch((e) => ({ error: String(e) }));
    out.micro.push({ file, bytes: readFileSync(`${root}/files/${file}.js`).length, ...r });
  }
  for (const file of ["eager_0", "eager_4", "eager_16", "eager_32", "eager_64", "eager_256", "lazy_16"]) {
    const r = await evaluate_in_chrome(rdp, `(async () => {
      const url = "file://${root}/files/${file}.js";
      const mgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
      const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin("http://example.com");
      const script = await ChromeUtils.compileScript(url, { hasReturnValue: false });
      const gc = () => { for (let i = 0; i < 4; i++) { Cu.forceGC(); Cu.forceCC(); Cu.forceShrinkingGC(); } };
      const used = () => mgr.JSMainRuntimeGCHeap + mgr.heapAllocated;
      gc(); const before = used();
      const keep = [];
      for (let i = 0; i < 300; i++) { const sb = Cu.Sandbox(principal, { wantXrays: true }); script.executeInGlobal(sb); keep.push(sb); }
      gc(); const after = used();
      for (const sb of keep) Cu.nukeSandbox(sb); keep.length = 0; gc();
      return { per_sandbox_bytes: Math.round((after - before) / 300) };
    })()`).catch((e) => ({ error: String(e) }));
    out.memory.push({ file, ...r });
  }
} finally { try { rdp.close(); } catch {} ff.kill("SIGTERM"); }
writeFileSync(`${work}/bench/micro.json`, JSON.stringify(out, null, 1));
for (const m of out.micro) console.log(JSON.stringify(m));
for (const m of out.memory) console.log(JSON.stringify(m));
setTimeout(() => process.exit(0), 1000);
