// The keymap read when many frames start at once, as after a `tree_updated` to a tab with 100 frames. Every frame sends the content script's own `read_keymap` message at one shared instant, and each records how long its reply took.
import { connect_rdp, install_temporary_addon, evaluate_in_background, evaluate_in_chrome } from "../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
const ID = "desertfox@uhs-robert";
const root = `${work}/keymap_burst/run`;
const FRAME_COUNTS = [1, 20, 100];
const ROUNDS = 5;
rmSync(root, { recursive: true, force: true });
mkdirSync(`${root}/profile`, { recursive: true });
writeFileSync(`${root}/profile/user.js`, readFileSync(`${repo}/test/key/user.js`, "utf8") + `\nuser_pref("privacy.reduceTimerPrecision", false);\n`);
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://x");
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  if (url.pathname === "/frame") return response.end("<!doctype html><p>frame</p>");
  const frames = Number(url.searchParams.get("frames"));
  response.end(`<!doctype html><title>burst</title><p>top</p>${Array.from({ length: frames - 1 }, (_, i) => `<iframe src="/frame?i=${i}"></iframe>`).join("")}<script>addEventListener("load",()=>{document.title="loaded"})</script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const debug_port = 6400 + Math.floor(Math.random() * 500);
const firefox = spawn("firefox", ["--headless", "-no-remote", "-profile", `${root}/profile`, "-start-debugger-server", String(debug_port), "about:blank"], { stdio: "ignore" });
let rdp;
for (let i = 0; i < 80; i++) { try { rdp = await connect_rdp(debug_port); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const background = (code) => evaluate_in_background(rdp, ID, code);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
try {
  await install_temporary_addon(rdp, `${repo}/dist`);
  await sleep(3000);
  const stored = await background(`(async () => { const all = await browser.storage.local.get(null); const key = Object.keys(all).find((k) => /keymap/i.test(k)); return { key, chars: JSON.stringify(all[key]).length }; })()`);
  console.log(JSON.stringify({ stored_keymap: stored }));
  for (const frames of FRAME_COUNTS) {
    const rounds = [];
    for (let round = 0; round < ROUNDS; round++) {
      const tab_id = await background(`(async () => { const tab = await browser.tabs.create({ url: ${JSON.stringify(`${base}/?frames=${frames}&r=${round}`)} }); for (let i = 0; i < 200; i++) { const now = await browser.tabs.get(tab.id); if (now.title === "loaded") break; await new Promise((r) => setTimeout(r, 100)); } return tab.id; })()`);
      await sleep(2000);
      // Each frame waits for the shared instant, sends the message and reports its own wait. The burst ends when the last reply lands.
      const ran = await background(`(async () => {
        const start = Date.now() + 1500;
        const code = "(async () => { await new Promise((r) => setTimeout(r, " + "START" + " - Date.now())); const t = performance.now(); const reply = await browser.runtime.sendMessage({ type: 'read_keymap', join: false }); return { wait_ms: performance.now() - t, chars: reply === undefined ? 0 : reply.length, end: Date.now() }; })()";
        const answers = await browser.tabs.executeScript(${tab_id}, { code: code.replace("START", String(start)), allFrames: true, matchAboutBlank: true });
        const waits = answers.filter(Boolean).map((a) => a.wait_ms);
        return { frames: answers.length, waits, burst_ms: Math.max(...answers.filter(Boolean).map((a) => a.end)) - start, reply_chars: answers[0]?.chars };
      })()`);
      await background(`browser.tabs.remove(${tab_id})`);
      rounds.push({ burst_ms: ran.burst_ms, max_wait_ms: Math.max(...ran.waits), median_wait_ms: median(ran.waits), frames: ran.frames, reply_chars: ran.reply_chars });
    }
    const row = { frames, rounds, median_burst_ms: median(rounds.map((r) => r.burst_ms)), median_max_wait_ms: median(rounds.map((r) => r.max_wait_ms)) };
    results.push(row);
    console.log(JSON.stringify({ frames, median_burst_ms: row.median_burst_ms, median_max_wait_ms: row.median_max_wait_ms, reply_chars: rounds[0].reply_chars, answered: rounds[0].frames }));
  }
} catch (error) { console.log("ERR", String(error.stack ?? error)); process.exitCode = 1; }
finally { try { rdp.close(); } catch {} firefox.kill("SIGTERM"); server.close(); }
writeFileSync(`${work}/keymap_burst/result.json`, JSON.stringify(results, null, 1));
setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
