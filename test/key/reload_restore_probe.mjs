// Probe, run by hand after a Firefox update: does `tabs.reload` on a discarded tab keep the scroll position and form data that
// session restore holds? Tab preload (src/background/tab_preload.ts) relies on it. Needs `just build` first. Starts its own headless
// Firefox, so it needs no nested session: `node test/key/reload_restore_probe.mjs` exits 0 when the state survives, 1 when not.
import { connect_rdp, install_temporary_addon, evaluate_in_background } from "./rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ID = "desertfox@uhs-robert";
const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "desertfox-reload-restore-"));
mkdirSync(`${root}/profile`, { recursive: true });
writeFileSync(`${root}/profile/user.js`, readFileSync(join(here, "user.js"), "utf8"));
const filler = "<p>" + "Lorem ipsum dolor sit amet. ".repeat(12) + "</p>";
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  res.end(`<!doctype html><title>t</title><body><textarea id=ta></textarea><input id=inp>${filler.repeat(150)}</body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const port = 6900 + Math.floor(Math.random() * 400);
const ff = spawn("firefox", ["--headless", "-no-remote", "-profile", `${root}/profile`, "-start-debugger-server", String(port), "about:blank"], { stdio: "ignore" });
let rdp;
for (let i = 0; i < 80; i++) { try { rdp = await connect_rdp(port); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const bg = (c) => evaluate_in_background(rdp, ID, c);
const out = {};
try {
  await install_temporary_addon(rdp, join(here, "../../dist"));
  await new Promise((r) => setTimeout(r, 3000));
  await bg(`(globalThis.__log=[], globalThis.__done=false, (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wait_complete = (id) => new Promise((resolve) => { const f = (tid, ch) => { if (tid === id && ch.status === "complete") { browser.tabs.onUpdated.removeListener(f); resolve(); } }; browser.tabs.onUpdated.addListener(f); });
    const probe = async (id) => { const [r] = await browser.tabs.executeScript(id, { code: "({y: Math.round(scrollY), ta: document.getElementById('ta').value, inp: document.getElementById('inp').value})" }); return r; };
    const first = (await browser.tabs.query({currentWindow: true}))[0].id;
    const res = {};
    for (const mode of ["reload", "activate"]) {
      const t = await browser.tabs.create({ url: "${base}/" + mode, active: true });
      await sleep(1500);
      await browser.tabs.executeScript(t.id, { code: "document.getElementById('ta').value='typed text'; document.getElementById('inp').value='form val'; scrollTo(0, 2500);" });
      await sleep(1000);
      await browser.tabs.update(first, { active: true });
      await sleep(300);
      await browser.tabs.discard(t.id);
      await sleep(500);
      res[mode + "_discarded"] = (await browser.tabs.get(t.id)).discarded;
      const done = wait_complete(t.id);
      if (mode === "reload") await browser.tabs.reload(t.id); else await browser.tabs.update(t.id, { active: true });
      await Promise.race([done, sleep(8000)]); await sleep(1500); globalThis.__log.push(mode);
      res[mode] = await probe(t.id);
      res[mode + "_active"] = (await browser.tabs.get(t.id)).active;
    }
    return res;
  })().then(r=>{globalThis.__res=r;globalThis.__done=true}, e=>{globalThis.__res=String(e);globalThis.__done=true}), 1)`);
  for (let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,1000)); if (await bg('globalThis.__done')===true) break; }
  out.r = await bg('globalThis.__res');
} catch (e) { out.error = String(e.stack ?? e); }
finally { try { rdp.close(); } catch {} ff.kill("SIGTERM"); server.close(); }
// Both paths must bring back the scroll position and both field values. `tabs.reload` must also leave the tab inactive.
const want = { y: 2500, ta: "typed text", inp: "form val" };
const same = (got) => got && got.y === want.y && got.ta === want.ta && got.inp === want.inp;
const ok = !out.error && same(out.r?.reload) && same(out.r?.activate) && out.r.reload_active === false && out.r.reload_discarded === true;
console.log(JSON.stringify(out, null, 1));
console.log(ok ? "ok: tabs.reload on a discarded tab keeps scroll and form data" : "FAIL: see above");
rmSync(root, { recursive: true, force: true });
setTimeout(() => process.exit(ok ? 0 : 1), 500);
