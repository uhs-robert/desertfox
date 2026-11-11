import { connect_rdp, install_temporary_addon, evaluate_in_background, evaluate_in_chrome } from "../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
const ID = "desertfox@uhs-robert";
const root = `${work}/tab/run`;
rmSync(root, { recursive: true, force: true });
mkdirSync(`${root}/profile`, { recursive: true });
writeFileSync(`${root}/profile/user.js`, readFileSync(`${repo}/test/key/user.js`, "utf8") + `
user_pref("privacy.reduceTimerPrecision", false);
user_pref("privacy.resistFingerprinting", false);
`);
const filler = "<p>" + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(12) + "</p>";
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  res.end(`<!doctype html><title>t ${req.url}</title><body>${filler.repeat(120)}</body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const debug_port = 6400 + Math.floor(Math.random() * 500);
const ff = spawn("firefox", ["--headless", "-no-remote", "-profile", `${root}/profile`, "-start-debugger-server", String(debug_port), "about:blank"], { stdio: "ignore" });
let rdp;
for (let i = 0; i < 80; i++) { try { rdp = await connect_rdp(debug_port); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const bg = (code) => evaluate_in_background(rdp, ID, code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { loaded: [], discarded: [], preload: [], misc: {} };
try {
  await install_temporary_addon(rdp, `${repo}/dist`);
  await sleep(3000);
  out.misc.setup = await bg(`(async () => {
    const now = () => performance.timeOrigin + performance.now();
    globalThis.__now = now; globalThis.__rec = [];
    browser.runtime.onMessage.addListener((m, s) => { __rec.push({ t: now(), type: m?.type, tab: s.tab?.id, frame: s.frameId }); });
    browser.tabs.onUpdated.addListener((id, ch) => { if (ch.status || ch.discarded !== undefined) __rec.push({ t: now(), type: "updated:" + (ch.status ?? "") + (ch.discarded === undefined ? "" : " discarded=" + ch.discarded), tab: id }); });
    browser.tabs.onActivated.addListener((i) => __rec.push({ t: now(), type: "activated", tab: i.tabId }));
    globalThis.__wait_complete = (id) => new Promise((resolve) => { const f = (tid, ch) => { if (tid === id && ch.status === "complete") { browser.tabs.onUpdated.removeListener(f); resolve(); } }; browser.tabs.onUpdated.addListener(f); });
    const all = await browser.storage.local.get(null);
    const sizes = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, JSON.stringify(v).length]));
    const mk = async (i) => { const t = await browser.tabs.create({ url: "${base}/p?i=" + i, active: i === 0 }); return t.id; };
    const ids = []; for (let i = 0; i < 3; i++) { const id = await mk(i); ids.push(id); }
    globalThis.__ids = ids;
    return { ids, sizes };
  })()`);
  await sleep(2500);
  // Reply size and background-side cost of the keymap answer; JSON.parse cost.
  out.misc.keymap = await bg(`(async () => {
    const all = await browser.storage.local.get(null);
    const key = Object.keys(all).find((k) => /keymap/i.test(k));
    const text = JSON.stringify(all[key]);
    const t0 = performance.now(); for (let i = 0; i < 50; i++) JSON.parse(text); const parse_ms = (performance.now() - t0) / 50;
    const t1 = performance.now(); for (let i = 0; i < 20; i++) await browser.storage.local.get(key); const get_ms = (performance.now() - t1) / 20;
    return { key, chars: text.length, parse_ms, storage_get_ms: get_ms, site_rules: (all[key].site_rules ?? []).length, top_keys: Object.keys(all[key]) };
  })()`);
  const read_page = `(async (id) => { const [r] = await browser.tabs.executeScript(id, { code: "(()=>{const t=performance.timing;const o=performance.timeOrigin;const fcp=performance.getEntriesByType('paint').map(e=>[e.name,e.startTime]);return {origin:o,rs:t.responseStart-t.navigationStart,di:t.domInteractive-t.navigationStart,dcl:t.domContentLoadedEventStart-t.navigationStart,load:t.loadEventStart-t.navigationStart,fcp,tree:document.documentElement.getAttribute('data-desertfox-tree-read-ms'),h:document.documentElement.scrollHeight}})()" }); return r; })`;
  for (let i = 0; i < 10; i++) {
    out.loaded.push(await bg(`(async () => { const [a, b] = __ids; await browser.tabs.update(a, { active: true }); await new Promise((r) => setTimeout(r, 300)); __rec.length = 0;
      const t0 = __now(); const tabs = await browser.tabs.query({ currentWindow: true }); const tq = __now(); await browser.tabs.update(b, { active: true }); const t1 = __now();
      await new Promise((r) => setTimeout(r, 200));
      return { query_ms: tq - t0, update_ms: t1 - tq, events: __rec.map((e) => [e.type, e.tab, +(e.t - t0).toFixed(1)]) }; })()`));
  }
  for (let i = 0; i < 10; i++) {
    out.discarded.push(await bg(`(async () => { const [a, b, c] = __ids; await browser.tabs.update(a, { active: true }); await browser.tabs.discard(c); await new Promise((r) => setTimeout(r, 400));
      const was = (await browser.tabs.get(c)).discarded; __rec.length = 0;
      const done = __wait_complete(c);
      const t0 = __now(); await browser.tabs.update(c, { active: true }); const t1 = __now();
      await done; await new Promise((r) => setTimeout(r, 250));
      const page = await (${read_page})(c);
      return { was, update_ms: t1 - t0, nav_start: page.origin - t0, page, events: __rec.filter((e) => e.tab === c).map((e) => [e.type, +(e.t - t0).toFixed(1)]) }; })()`));
  }
  for (let i = 0; i < 6; i++) {
    out.preload.push(await bg(`(async () => { const [a, b, c] = __ids; await browser.tabs.update(a, { active: true }); await browser.tabs.discard(c); await new Promise((r) => setTimeout(r, 400));
      const was = (await browser.tabs.get(c)).discarded; __rec.length = 0;
      const done = __wait_complete(c);
      const t0 = __now(); await browser.tabs.reload(c); const t1 = __now();
      await done; await new Promise((r) => setTimeout(r, 250));
      const after = await browser.tabs.get(c);
      const page = await (${read_page})(c);
      const s0 = __now(); await browser.tabs.update(c, { active: true }); const s1 = __now();
      return { was, reload_call_ms: t1 - t0, still_inactive: !after.active, discarded_after: after.discarded, nav_start: page.origin - t0, page, switch_ms: s1 - s0, events: __rec.filter((e) => e.tab === c).map((e) => [e.type, +(e.t - t0).toFixed(1)]) }; })()`));
  }
  // warmup call cost only (headless has no compositor, so the paint gain cannot show here).
  out.misc.warmup = await bg(`(async () => { const [a, b] = __ids; await browser.tabs.update(a, { active: true }); const t0 = __now(); await browser.tabs.warmup(b); return { warmup_call_ms: __now() - t0 }; })()`);
} catch (error) { out.error = String(error.stack ?? error); process.exitCode = 1; }
finally { try { rdp.close(); } catch {} ff.kill("SIGTERM"); server.close(); }
writeFileSync(`${work}/tab/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.misc), out.error ?? "");
for (const r of out.loaded) console.log("L", JSON.stringify(r));
for (const r of out.discarded) console.log("D", JSON.stringify(r));
for (const r of out.preload) console.log("P", JSON.stringify(r));
setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
