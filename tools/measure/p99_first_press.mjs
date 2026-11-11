// Key-test piece: first-press timing of lazy bundles and the early-j case. See README.md for how to run it.
// The slow_body case needs a /slow_body route in test/key/server.mjs that this repo does not have yet. The slow-body key test PR (PR B) adds it. Until then the page loads at once and the early-j case does not delay the body.
import { appendFileSync, mkdirSync } from "node:fs";
const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
mkdirSync(`${work}/fp`, { recursive: true });
export const areas = ["keys"];
const OUT = `${work}/fp/out.jsonl`;
const out = (row) => appendFileSync(OUT, JSON.stringify(row) + "\n");
const HINTS_LAYER = 2147483647 - 4;
const PROBE = `(() => { const now = () => performance.timeOrigin + performance.now(); const fp = (window.__fp ??= { ev: [] }); fp.ev.length = 0;
  if (!fp.armed) { fp.armed = true; addEventListener("keydown", (e) => fp.ev.push(["keydown:" + e.key, now()]), true); }
  clearInterval(fp.timer); const seen = {}; const mark = (k) => { if (!seen[k]) { seen[k] = 1; fp.ev.push([k, now()]); requestAnimationFrame(() => fp.ev.push([k + ":raf", now()])); } };
  const end = now() + 2500;
  fp.timer = setInterval(() => { if (now() > end) return clearInterval(fp.timer);
    const kids = [...document.documentElement.children, ...(document.body?.children ?? [])];
    const hints = kids.find((c) => c.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}");
    if (hints) mark("hint_host"); if (hints?.openOrClosedShadowRoot?.querySelector(".desertfox-hint")) mark("hint_labels");
    if (document.documentElement.querySelector("[data-desertfox-whichkey]")?.getAttribute("data-desertfox-whichkey")) mark("whichkey");
    const frame_host = kids.find((c) => c.openOrClosedShadowRoot?.querySelector("iframe")); if (frame_host) mark("cmdline_iframe");
    if (frame_host && document.activeElement === frame_host) mark("cmdline_focus");
  }, 1);
  return 1; })()`;

export async function run_cases({ run_case, in_background, url_of, open_page, press_keys, sleep, in_active_tab, events, wait_event }) {
  const arm_background = () => in_background(`(() => { if (globalThis.__fp_rec) return 1; globalThis.__fp_rec = []; const now = () => performance.timeOrigin + performance.now();
    browser.runtime.onMessage.addListener((m, s) => { __fp_rec.push([m?.type + (m?.name ? ":" + m.name : ""), now(), s.frameId ?? -1, s.url?.startsWith("moz-extension") ? "ext" : "page"]); }); return 1; })()`);
  const bundles_seen = {};
  async function press_and_read(key, label, phase) {
    await in_active_tab(PROBE);
    await in_background(`(globalThis.__fp_rec.length = 0, 1)`);
    const before = Date.now();
    await press_keys(key);
    const after = Date.now();
    await sleep(1000);
    const ev = JSON.parse(await in_active_tab("JSON.stringify(window.__fp.ev)"));
    const bg = await in_background(`globalThis.__fp_rec.slice(0, 25)`);
    out({ label, phase, key, before, after, ev, bg });
    for (const [type] of bg) if (type.startsWith("load_bundle:")) (bundles_seen[key] ??= new Set()).add(type.slice(12));
    await press_keys("-k", "Escape");
    await sleep(400);
  }
  const KEYS = [["f", "hints", ["hints"]], [":", "cmdline", ["cmdline"]], ["/", "find", ["cmdline"]], ["g", "whichkey", ["whichkey"]]];
  await run_case("calibrate key latency", async () => {
    await arm_background();
    await open_page("hints", "fp_cal", { new_tab: true });
    for (let i = 0; i < 6; i++) {
      await in_active_tab(PROBE);
      const before = Date.now(); await press_keys("-k", "F8"); const after = Date.now();
      await sleep(250);
      out({ label: "calibrate", before, after, ev: JSON.parse(await in_active_tab("JSON.stringify(window.__fp.ev)")) });
    }
  });
  for (const [key, label] of KEYS) {
    await run_case(`fresh ${label}`, async () => {
      for (let i = 0; i < 4; i++) {
        await open_page("hints", `fp_${label}_${i}`, { new_tab: true });
        await sleep(300);
        await press_and_read(key, label, "first");
        await press_and_read(key, label, "second");
      }
    });
  }
  for (const [key, label, fallback] of KEYS) {
    await run_case(`preloaded ${label}`, async () => {
      const names = [...(bundles_seen[key] ?? fallback)].filter((name) => name !== "ui");
      for (let i = 0; i < 4; i++) {
        await open_page("hints", `fp_pre_${label}_${i}`, { new_tab: true });
        const inject_ms = await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); const t0 = performance.now(); for (const name of ${JSON.stringify(names)}) await browser.tabs.executeScript(tab.id, { file: "/" + name + ".js", frameId: 0 }); return performance.now() - t0; })()`);
        out({ label, phase: "inject", names, inject_ms });
        await sleep(400);
        await press_and_read(key, label, "preloaded");
      }
    });
  }
  for (const group of [0, 1]) {
    await run_case(`early j on a slow body ${group}`, async () => {
      for (let i = 0; i < 3; i++) {
        const id = `sb_${group}_${i}`;
        const mark = events.length;
        const opened = Date.now();
        await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of("slow_body", id) + "&ms=3000")}, active: true }).then((tab) => tab.id)`);
        const tree = await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, "tree_read on the slow page", 5000);
        await sleep(400);
        const in_active_tab = (code) => in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); return (await browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)}, runAt: "document_start" }))[0]; })()`);
        const state = "JSON.stringify({ y: scrollY, h: document.documentElement.scrollHeight, inner: innerHeight, ready: document.readyState, focus: document.hasFocus() })";
        const pre = JSON.parse(await in_active_tab(state));
        const pressed = Date.now();
        await press_keys("j");
        await sleep(400);
        const mid = JSON.parse(await in_active_tab(state));
        await sleep(Math.max(0, opened + 3600 - Date.now()));
        const late = JSON.parse(await in_active_tab(state));
        await press_keys("j");
        await sleep(500);
        const control = JSON.parse(await in_active_tab(state));
        const page_saw_j = events.slice(mark).filter((event) => event.page_id === id && event.type === "keydown" && event.key === "j").map((event) => event.at_ms - opened);
        out({ label: "slow_body", id, tree_read_after_open: tree.at_ms - opened, pressed_after_open: pressed - opened, pre, mid, late, control, page_saw_j });
      }
    });
  }
}
