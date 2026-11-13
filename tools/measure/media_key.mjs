// Key-to-action time of `media volume up`: from the moment a frame sends the `run` message (what a key press sends) to the `volumechange` of the video. Pages hold 1 frame, 20 frames, and 20 frames with one that refuses scripts or one that never answers.
import { connect_rdp, install_temporary_addon, evaluate_in_background } from "../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
const ID = "desertfox@uhs-robert";
const root = `${work}/media_key/run`;
const CASES = [
  { name: "1 frame", frames: 1 },
  { name: "20 frames", frames: 20 },
  { name: "20 frames, one refuses scripts", frames: 18, extra: "refuse" },
  { name: "20 frames, one never answers", frames: 19, extra: "hang" },
  // The video sits in the extra frame only (the top video is tiny), so the key acts only if the frame was reached.
  { name: "20 frames, video in an about:blank frame", frames: 19, extra: "blank" },
  { name: "20 frames, video in a srcdoc frame", frames: 19, extra: "srcdoc" },
  // Negative case: media.js cannot run in a data: frame, so the key goes to the small top video and the action time stays null.
  { name: "20 frames, negative: video only in a data: frame", frames: 19, extra: "data" },
];
const ROUNDS = 6;
rmSync(root, { recursive: true, force: true });
mkdirSync(`${root}/profile`, { recursive: true });
writeFileSync(`${root}/profile/user.js`, readFileSync(`${repo}/test/key/user.js`, "utf8") + `\nuser_pref("privacy.reduceTimerPrecision", false);\n`);
// A second of silence at 8 kHz, so the video has a source.
const wav = (() => { const samples = 8000; const header = Buffer.alloc(44); header.write("RIFF", 0); header.writeUInt32LE(36 + samples, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(8000, 28); header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34); header.write("data", 36); header.writeUInt32LE(samples, 40); return Buffer.concat([header, Buffer.alloc(samples, 0x80)]); })();
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://x");
  if (url.pathname === "/tone.wav") { response.writeHead(200, { "content-type": "audio/wav" }); return response.end(wav); }
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  if (url.pathname === "/frame") return response.end("<!doctype html><p>frame</p>");
  // Blocks the frame's thread for 20 s, so it answers nothing in that time.
  if (url.pathname === "/hang") return response.end("<!doctype html><script>const end = Date.now() + 20000; while (Date.now() < end);</script>");
  const frames = Number(url.searchParams.get("frames"));
  const extra = url.searchParams.get("extra");
  const hang_origin = `http://localhost:${request.socket.localPort}`;
  const extra_frame = extra === "refuse" ? '<iframe src="data:text/html,refused"></iframe><iframe sandbox srcdoc="<p>refused</p>"></iframe>' : extra === "hang" ? `<iframe src="${hang_origin}/hang"></iframe>` : extra === "blank" ? '<iframe id="blank"></iframe>' : extra === "srcdoc" ? '<iframe srcdoc="<video id=v src=/tone.wav loop style=display:block;width:320px;height:180px></video>"></iframe>' : extra === "data" ? `<iframe src="data:text/html,${encodeURIComponent(`<video id=v src="${hang_origin}/tone.wav" loop style="display:block;width:320px;height:180px"></video><script>var v=document.getElementById("v");v.volume=0.5;setTimeout(function(){v.addEventListener("volumechange",function(){parent.postMessage("vol","*")})},250)</script>`)}"></iframe>` : "";
  const in_extra = ["blank", "srcdoc", "data"].includes(extra);
  const video = `<video id="video" src="/tone.wav" loop style="display:block;width:${in_extra ? 10 : 320}px;height:${in_extra ? 10 : 180}px"></video>`;
  response.end(`<!doctype html><title>media</title>${video}${Array.from({ length: frames - 1 }, (_, i) => `<iframe src="/frame?i=${i}"></iframe>`).join("")}${extra_frame}<script>
    const video = document.getElementById("video"); video.volume = 0.5;
    // The listener comes after the volume set above has fired its own event.
    addEventListener("DOMContentLoaded", () => setTimeout(() => {
      const watch = (media) => { media.volume = 0.5; setTimeout(() => media.addEventListener("volumechange", () => { document.title = "vol " + Date.now(); }), 50); };
      const blank = document.getElementById("blank");
      if (blank) { const inner = blank.contentDocument.createElement("video"); inner.src = location.origin + "/tone.wav"; inner.loop = true; inner.style = "display:block;width:320px;height:180px"; blank.contentDocument.body.append(inner); watch(inner); }
      const srcdoc = ${JSON.stringify(extra === "srcdoc")} ? document.querySelector("iframe[srcdoc]") : null;
      if (srcdoc) watch(srcdoc.contentDocument.getElementById("v"));
      addEventListener("message", (event) => { if (event.data === "vol") document.title = "vol " + Date.now(); });
      // The top video's title differs when the extra frame holds the video, so a null action time means the key went to the wrong video.
      video.addEventListener("volumechange", () => { document.title = ${JSON.stringify(in_extra)} ? "top " + Date.now() : "vol " + Date.now(); }); document.title = "loaded"; }, 200));</script>`);
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
  for (const { name, frames, extra } of CASES) {
    const times = [];
    const replies = [];
    for (let round = 0; round < ROUNDS; round++) {
      const url = `${base}/?frames=${frames}&extra=${extra ?? ""}&r=${round}`;
      const tab_id = await background(`(async () => { const tab = await browser.tabs.create({ url: ${JSON.stringify(url)} }); for (let i = 0; i < 200; i++) { const now = await browser.tabs.get(tab.id); if (now.title === "loaded") break; await new Promise((r) => setTimeout(r, 100)); } return tab.id; })()`);
      await sleep(1500);
      const list_ms = await background(`(async () => { const t = performance.now(); await browser.webNavigation.getAllFrames({ tabId: ${tab_id} }); return Math.round(performance.now() - t); })()`);
      const sent = await background(`(async () => {
        const code = "(async () => { const t = Date.now(); const reply = await browser.runtime.sendMessage({ type: 'run', mode: 'normal', invocations: [{ id: 'media.act', args: { action: 'volume', value: 'up', times: 1 } }] }); return { t, done: Date.now(), ok: reply?.ok, message: reply?.refusal?.message }; })()";
        const [answer] = await browser.tabs.executeScript(${tab_id}, { code, frameId: 0 });
        const tab = await browser.tabs.get(${tab_id});
        return { ...answer, title: tab.title };
      })()`);
      const changed = /^vol (\d+)$/.exec(sent.title);
      times.push(changed ? Number(changed[1]) - sent.t : null);
      replies.push({ list_ms, reply_ms: sent.done - sent.t, ok: sent.ok, message: sent.message });
      await background(`browser.tabs.remove(${tab_id})`);
    }
    // The first round of a case runs cold, so it is left out of the median.
    times.shift(); replies.shift();
    const seen = times.filter((t) => t !== null);
    results.push({ name, action_ms: times, median_action_ms: seen.length ? median(seen) : null, replies });
    console.log(JSON.stringify({ name, median_action_ms: seen.length ? median(seen) : null, action_ms: times, median_reply_ms: median(replies.map((r) => r.reply_ms)), list_ms: replies.map((r) => r.list_ms), ok: replies.map((r) => r.ok), message: replies[0].message }));
  }
} catch (error) { console.log("ERR", String(error.stack ?? error)); process.exitCode = 1; }
finally { try { rdp.close(); } catch {} firefox.kill("SIGTERM"); server.close(); }
writeFileSync(`${work}/media_key/result.json`, JSON.stringify(results, null, 1));
setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
