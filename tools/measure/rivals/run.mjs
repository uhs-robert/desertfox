// One tool alone in a fresh headless Firefox profile, over the pages. Run by rivals.mjs, which sets RIVALS_DIR, PASS and PAGES.
// usage: node run.mjs <tool> [runs]
// Per page it records load times, the time from the hint key to the first label, and the memory of the page and extension processes.
import { connect_rdp, install_temporary_addon, evaluate_in_chrome } from "../../../test/key/rdp.mjs";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as create_port_probe } from "node:net";
import { match_labels } from "./match_labels.mjs";
import { page_body } from "./pages.mjs";
import { GENERIC_CHECKS, judge_activation, judge_cell_move, judge_escape, judge_hints, judge_jk_clash, judge_play_pause, judge_scroll, judge_volume, page_wall, pick_activation, SITES, TOOL_KEYS } from "./sites.mjs";
import { analyze_tab_switch, NEXT_TAB_KEY, RETRY_MS } from "./tab_timing.mjs";
import { CHECK_FAILED_STATUS, DESERTFOX_ID, PAGE_NAMES, PINNED_BUILDS, xpi_path } from "./tools.mjs";

const tool = process.argv[2];
const timed_runs = Number(process.argv[3] ?? 7);
const repo_dir = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const work_dir = process.env.RIVALS_DIR;
const script_dir = new URL(".", import.meta.url).pathname;
const pass = process.env.PASS ?? "0";
const page_names = (process.env.PAGES ?? PAGE_NAMES.join(",")).split(",");

const addon = tool === "none" ? null : tool === "desertfox" ? { path: `${repo_dir}/dist`, id: DESERTFOX_ID } : { path: xpi_path(work_dir, tool), id: PINNED_BUILDS[tool].gecko_id };

const profile_dir = `${work_dir}/profiles/${tool}`;
rmSync(profile_dir, { recursive: true, force: true });
mkdirSync(profile_dir, { recursive: true });
// Timer precision is off so that sub-millisecond marks are not rounded to 1 ms or more.
writeFileSync(`${profile_dir}/user.js`, `${readFileSync(`${repo_dir}/test/key/user.js`, "utf8")}\nuser_pref("privacy.reduceTimerPrecision", false);\n`);

class CheckFailed extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createServer((request, response) => {
  const body = page_body(new URL(request.url, "http://x").pathname.slice(1));
  response.writeHead(body === null ? 404 : 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(body ?? "");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base_url = `http://127.0.0.1:${server.address().port}`;

// Ask the system for a free port, so two runs at once cannot collide.
const debug_port = await new Promise((resolve, reject) => {
  const probe = create_port_probe();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const firefox_process = spawn("firefox", ["--headless", "-no-remote", "-profile", profile_dir, "-start-debugger-server", String(debug_port), "about:blank"], { stdio: "ignore" });
const firefox_exited = new Promise((resolve) => firefox_process.once("exit", resolve));
firefox_process.once("error", (error) => { console.log("ERR cannot start firefox (is it on the PATH?):", String(error)); process.exit(1); });

// The next tool must not start while this Firefox is still exiting, so the exit is awaited, with SIGKILL after 5 s.
async function stop_firefox() {
  if (firefox_process.exitCode !== null || firefox_process.signalCode !== null) return;
  firefox_process.kill("SIGTERM");
  const timer = setTimeout(() => firefox_process.kill("SIGKILL"), 5000);
  await firefox_exited;
  clearTimeout(timer);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop_firefox().finally(() => process.exit(130)); });

let rdp;
for (let attempt = 0; attempt < 120 && !rdp; attempt++) {
  try { rdp = await connect_rdp(debug_port); } catch { await sleep(250); }
}
if (!rdp) { await stop_firefox(); throw new Error("no debugger connection to Firefox"); }

const chrome = (code) => evaluate_in_chrome(rdp, code);
const selected_browser = `Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser`;
let slot_count = 0;
const RESULT_SLICE = 8000;

// The debugger gives one evaluation 5 s, so a long job stores its result in a chrome global and node polls for it.
async function chrome_long(async_code, limit_ms) {
  const slot = `__rivals_slot_${++slot_count}`;
  await chrome(`(globalThis.${slot} = undefined, (async () => ${async_code})().then((value) => { globalThis.${slot} = JSON.stringify(value ?? null); }, (error) => { globalThis.${slot} = JSON.stringify({ error: String(error) }); }), 1)`);
  const deadline = Date.now() + limit_ms;
  while (Date.now() < deadline) {
    await sleep(150);
    const length = await chrome(`globalThis.${slot}?.length ?? -1`);
    if (length >= 0) {
      // The debugger sends a string over about 10,000 characters only by reference, so a long result comes in slices.
      let stored = "";
      for (let at = 0; at < length; at += RESULT_SLICE) stored += await chrome(`globalThis.${slot}.slice(${at}, ${at + RESULT_SLICE})`);
      await chrome(`(delete globalThis.${slot}, 1)`);
      const value = JSON.parse(stored);
      // The wrapper above stores a rejection as { error }, and a failed job must fail the run, not pass as a result.
      if (value !== null && typeof value === "object" && Object.keys(value).length === 1 && typeof value.error === "string") throw new Error(`chrome job failed: ${value.error}`);
      return value;
    }
  }
  throw new Error("long job timeout");
}

const navigate = (url) => chrome(`(async () => { ${selected_browser}.fixupAndLoadURIString(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); return 1; })()`);

const frame_script_url = `data:application/javascript;charset=utf-8,${encodeURIComponent(readFileSync(`${script_dir}framescript.js`, "utf8"))}`;
// Loaded again after each navigation because a new content process has not run it. The script guards against a second load in one process.
const load_frame_script = () => chrome(`(async () => { ${selected_browser}.messageManager.loadFrameScript(${JSON.stringify(frame_script_url)}, false); return 1; })()`);

// Sends a message to the frame script and waits for its one reply.
const ask_page = (name, data = {}, limit_ms = 2000) => chrome_long(`{ const message_manager = ${selected_browser}.messageManager; return await new Promise((resolve) => { const on_reply = (message) => { message_manager.removeMessageListener("rivals:reply", on_reply); resolve(message.data); }; message_manager.addMessageListener("rivals:reply", on_reply); message_manager.sendAsyncMessage("rivals:${name}", ${JSON.stringify(data)}); }); }`, limit_ms);

// RSS of the page's content process and of the extension process, and extension heap from the memory reports.
async function memory() {
  await chrome(`(Services.obs.notifyObservers(null, "child-mmu-request"), 1)`);
  // The memory-minimize request is asynchronous and has no completion signal.
  await sleep(2500);
  return chrome_long(`{
    const page_pid = ${selected_browser}.browsingContext.currentWindowGlobal.domProcess.osPid;
    const info = await ChromeUtils.requestProcInfo();
    const page_process = info.children.find((child) => child.pid === page_pid);
    const extension_processes = info.children.filter((child) => child.type === "extension");
    const heap = await new Promise((resolve) => {
      const manager = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
      const totals = { content_ext_heap: 0, ext_proc_heap: 0 };
      manager.getReports((process, path, kind, units, amount) => {
        if (units !== 0 || !path.startsWith("explicit/") || !path.includes("moz-extension")) return;
        if (process.startsWith("extension")) totals.ext_proc_heap += amount;
        else if (process.includes(" " + page_pid + ")")) totals.content_ext_heap += amount;
      }, null, () => resolve(totals), null, false);
    });
    return { content_rss: page_process ? page_process.memory : null, ext_rss: extension_processes.reduce((sum, child) => sum + child.memory, 0), ext_procs: extension_processes.length, ...heap };
  }`, 30000);
}

// A system policy (/etc/firefox/policies) can force-install the release DesertFox into every profile, which would bias every row.
const policy_addon_state = () => chrome_long(`{ const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"); const addon = await AddonManager.getAddonByID("${DESERTFOX_ID}"); if (addon && !addon.temporarilyInstalled) { await addon.uninstall(); return "removed"; } return addon ? "temporary" : "absent"; }`, 8000);

async function remove_policy_addon() {
  // The policy installs after startup, so "absent" counts only after a wait that covers a late install.
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await policy_addon_state();
    if (state === "removed" || (state === "absent" && attempt >= 12)) return state;
    await sleep(500);
  }
  throw new Error("the policy-installed DesertFox is still present: the run would be biased");
}

// Navigates the selected tab to the url and waits until it has loaded. Returns the last page state and whether it loaded, so a failed load keeps its diagnosis.
// A document with no navigation entry, such as the PDF viewer, reports a null load time and counts as loaded once complete.
async function open_page(url, attempts = 150) {
  await navigate("about:blank");
  await sleep(700);
  await navigate(url);
  let page_state = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await sleep(100);
    try {
      await load_frame_script();
      page_state = await ask_page("state");
    } catch { continue; }
    if (page_state?.ready === "complete" && (page_state.load ?? 1) > 0 && page_state.url !== "about:blank") return { page_state, loaded: true };
  }
  return { page_state, loaded: false };
}

// One tab-switch run. Tab 0 is loaded and active, tabs 1 and 2 are loaded once and then discarded, so Firefox has to load them on arrival.
// The key in tab 0 switches to tab 1 (hop A, the control: a loaded script catches it). From the moment tab 1 becomes active a press goes out every RETRY_MS until tab 2 becomes active (hop B).
// Everything runs in one chrome job on one clock, so the debugger round trips are outside the interval. Races, all counted in the record and not hidden:
// - The first press is queued with setTimeout(0) from the TabSelect handler, so it never runs inside the event dispatch.
// - A press sent while the old page or no page owns focus is lost. The record counts presses sent before the landing.
// - A press in flight at the landing can still work and switch again (extra_hops), because the loop stops only when the landing event runs.
// - Tab 1 loads while hop B runs, so server and parse time are inside the interval for every tool alike (the server answers in a few ms and sends no-store). Tab 2 starts to load only after the interval.
// - The press gap is longer than RETRY_MS because the parent process is busy restoring tab 1, so presses_b_ms is kept in the run record and analyze.mjs reports the measured gap.
async function tab_switch_run(next_key) {
  const marks = await chrome_long(`{
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    const tabbrowser = win.gBrowser;
    const now = () => win.performance.now();
    const wait = (ms) => new Promise((resolve) => win.setTimeout(resolve, ms));
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    while (tabbrowser.tabs.length > 1) tabbrowser.removeTab(tabbrowser.tabs[tabbrowser.tabs.length - 1]);
    const tabs = [tabbrowser.tabs[0]];
    for (const n of [1, 2]) {
      const tab = tabbrowser.addTab(${JSON.stringify(base_url)} + "/tab?n=" + n, { triggeringPrincipal: principal, skipAnimation: true });
      tabs.push(tab);
      for (let waited = 0; waited < 5000 && (tab.hasAttribute("busy") || tab.linkedBrowser.currentURI.spec === "about:blank"); waited += 50) await wait(50);
    }
    tabbrowser.selectedTab = tabs[0];
    await wait(300);
    for (const tab of tabs.slice(1)) tabbrowser.discardBrowser(tab, true);
    await wait(500);
    const pending_at_start = tabs.slice(1).map((tab) => tab.hasAttribute("pending"));
    tabbrowser.selectedBrowser.focus();
    await wait(300);
    const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
    const press = () => {
      tip.beginInputTransactionForTests(win);
      const shift = new win.KeyboardEvent("", { key: "Shift", code: "ShiftLeft", keyCode: 16 });
      const key = new win.KeyboardEvent("", { key: ${JSON.stringify(next_key)}, code: ${JSON.stringify("Key" + next_key)}, keyCode: ${next_key.charCodeAt(0)}, shiftKey: true });
      tip.keydown(shift); tip.keydown(key); tip.keyup(key); tip.keyup(shift);
    };
    const marks = { selects: [], presses_b_ms: [], key_a_ms: null, pending_at_start, retry_ms: ${RETRY_MS} };
    let landed = false;
    let arrived_ms = null;
    const tick = () => {
      if (landed || now() - arrived_ms > 6000) return;
      marks.presses_b_ms.push(now());
      press();
      win.setTimeout(tick, ${RETRY_MS});
    };
    const on_select = (event) => {
      const index = tabs.indexOf(event.target);
      marks.selects.push({ index, ms: now() });
      if (index === 1 && arrived_ms === null) { arrived_ms = now(); tabbrowser.selectedBrowser.focus(); win.setTimeout(tick, 0); }
      if (index === 2 && arrived_ms !== null) landed = true;
    };
    tabbrowser.tabContainer.addEventListener("TabSelect", on_select);
    marks.key_a_ms = now();
    press();
    for (let waited = 0; waited < 9000 && !landed; waited += 20) await wait(20);
    await wait(600);
    tabbrowser.tabContainer.removeEventListener("TabSelect", on_select);
    while (tabbrowser.tabs.length > 1) tabbrowser.removeTab(tabbrowser.tabs[tabbrowser.tabs.length - 1]);
    return marks;
  }`, 40000);
  if (!marks.pending_at_start.every(Boolean)) throw new CheckFailed(`tabs 1 and 2 were not unloaded at the start (pending: ${marks.pending_at_start})`);
  const timing = analyze_tab_switch(marks);
  if (timing.error) throw new CheckFailed(`tab switch cannot be measured: ${timing.error}`);
  return { ...timing, selects: marks.selects, presses_b_ms: marks.presses_b_ms };
}

// One site for the live-site check: the per-site checks first, on the fresh page, then the generic ones. Typing a label comes last because it can leave the page.
// A wall (consent, bot check, login) is not a fail of the tool, so every check of the site takes the wall's status. A check that throws is an error, not a fail.
// open_page polls every 100 ms, so a live page gets about 30 s to load.
const LIVE_LOAD_ATTEMPTS = 300;
const RENDER_MS = 5000;
async function check_site(site) {
  const keys = TOOL_KEYS[tool];
  const url = site.url ?? `${base_url}/${site.path}`;
  const check_names = [...site.extra, ...GENERIC_CHECKS];
  const { page_state, loaded } = await open_page(url, LIVE_LOAD_ATTEMPTS);
  if (!page_state) return { url, checks: Object.fromEntries(check_names.map((name) => [name, { status: "error", reason: "the page never answered" }])) };
  // Apps render after the load event, and a page that never completes still gets its checks.
  await sleep(RENDER_MS);
  await chrome(`(async () => { ${selected_browser}.focus(); return 1; })()`);
  // A page that swapped its content process has lost the frame script, so a first miss loads it again.
  const info = await ask_page("page_info", {}, 5000).catch(async () => { await load_frame_script(); return ask_page("page_info", {}, 5000); });
  const record = { url, loaded, landed_url: info.url, title: info.title, checks: {} };
  const wall = page_wall(info);
  if (wall) { for (const name of check_names) record.checks[name] = wall; return record; }
  const no_key = { status: "fail", reason: "no default key" };
  const press_and_compare = async (key, read, judge, wait_ms) => {
    if (!key) return no_key;
    const before = await ask_page(read, {}, 5000);
    await ask_page("keys", { keys: key }, 5000);
    await sleep(wait_ms);
    return judge(before, await ask_page(read, {}, 5000));
  };
  // The embedded player answers once YouTube's iframe API has loaded it.
  const wait_for_embed = async () => {
    for (let waited = 0; waited < 20000; waited += 500) { if (await ask_page("embed_state", {}, 5000)) return; await sleep(500); }
  };
  const extra_checks = {
    play_pause: () => press_and_compare(keys.play_pause, "video_state", judge_play_pause, 1500),
    volume: () => press_and_compare(keys.volume_down, "video_state", judge_volume, 1000),
    cell_move: () => press_and_compare(keys.scroll_down, "name_box", judge_cell_move, 1000),
    jk_clash: async () => {
      const post_before = await ask_page("post_focus", {}, 5000);
      const scroll = await ask_page("scroll_check", { keys: keys.scroll_down, wait_ms: 1000 }, 10000);
      const post_after = await ask_page("post_focus", {}, 5000);
      return judge_jk_clash({ scrolled: scroll.window_dy !== 0 || scroll.element_dy !== 0, post_focus_moved: post_after !== null && post_after !== post_before });
    },
    embed_play_pause: async () => { await wait_for_embed(); return press_and_compare(keys.play_pause, "embed_state", judge_play_pause, 2500); },
    embed_volume: () => press_and_compare(keys.volume_down, "embed_state", judge_volume, 1500),
  };
  const show_hints = () => ask_page("hints", { keys: keys.hint, settle_ms: 1500 }, 15000);
  let shown = null;
  const generic_checks = {
    scroll: async () => judge_scroll(await ask_page("scroll_check", { keys: keys.scroll_down, wait_ms: 1000 }, 10000)),
    hints: async () => { shown = await show_hints(); return judge_hints(shown.labels, shown.targets); },
    escape: async () => {
      if (!shown?.labels.length) return { status: "fail", reason: "no labels to leave" };
      await ask_page("escape");
      await sleep(800);
      return judge_escape(await ask_page("label_count", {}, 5000));
    },
    activate: async () => {
      const again = await show_hints();
      const pick = pick_activation(again.labels, again.targets);
      if (!pick) return { status: "fail", reason: "no label on a visible target to type" };
      return { ...judge_activation(await ask_page("activate", { ...pick, wait_ms: 3000 }, 15000)), typed: pick.keys };
    },
  };
  for (const name of check_names) {
    try { record.checks[name] = await (extra_checks[name] ?? generic_checks[name])(); }
    catch (error) { record.checks[name] = { status: "error", reason: String(error.message ?? error).slice(0, 200) }; }
  }
  return record;
}

const result = { tool, base_url, date: new Date().toISOString(), firefox: "", meta: {}, runs: [] };
const log_row = (row) => console.log(JSON.stringify(row));
try {
  result.firefox = await chrome(`Services.appinfo.version`);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await chrome(`!!Services.wm.getMostRecentWindow("navigator:browser")?.gBrowser?.selectedBrowser`) === true) break;
    await sleep(500);
  }
  await sleep(1000);
  result.meta.policy_addon = await remove_policy_addon();
  await sleep(1000);
  await load_frame_script();
  if (addon) {
    const installing_since = Date.now();
    await install_temporary_addon(rdp, addon.path);
    result.meta.install_ms = Date.now() - installing_since;
    // The extension's background start-up and first-run work settle in this time.
    await sleep(8000);
    result.meta.permissions = await chrome(`(async () => { const policy = WebExtensionPolicy.getByID(${JSON.stringify(addon.id)}); return policy ? { manifest_version: policy.manifestVersion, active: policy.active, host_all: policy.allowedOrigins.matches("http://127.0.0.1/"), host_live: policy.allowedOrigins.matches("https://example.com/") } : null; })()`);
    result.meta.version = await chrome_long(`{ const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"); return (await AddonManager.getAddonByID(${JSON.stringify(addon.id)}))?.version ?? null; }`, 8000);
    if (tool === "desertfox") result.meta.commit = spawnSync("git", ["-C", repo_dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
    if (!result.meta.permissions?.active) throw new Error(`${tool} is not active after install`);
    if (tool !== "desertfox" && (await policy_addon_state()) !== "absent") throw new Error("the policy-installed DesertFox came back after the install");
    // Close tabs the extension opened (options, welcome pages) and refocus the first.
    await chrome(`(async () => { const tabs = Services.wm.getMostRecentWindow("navigator:browser").gBrowser; while (tabs.tabs.length > 1) tabs.removeTab(tabs.tabs[tabs.tabs.length - 1]); tabs.selectedTab = tabs.tabs[0]; return 1; })()`);
    await sleep(500);
  }
  log_row(result.meta);
  for (const page of page_names) {
    if (page === "sites") {
      if (!addon) continue;
      result.meta.sites = { keys: TOOL_KEYS[tool], settings: "extension defaults" };
      const only_sites = process.env.SITES?.split(",");
      for (const site of SITES.filter((entry) => !only_sites || only_sites.includes(entry.name))) {
        // One site that hangs the debugger must not cost the other sites their results.
        const record = await check_site(site).catch((error) => ({ url: site.url ?? site.path, checks: Object.fromEntries([...site.extra, ...GENERIC_CHECKS].map((name) => [name, { status: "error", reason: String(error.message ?? error).slice(0, 200) }])) }));
        result.runs.push({ page, run: 0, site: site.name, ...record });
        log_row({ site: site.name, ...Object.fromEntries(Object.entries(record.checks).map(([name, check]) => [name, `${check.status}: ${check.reason}`])) });
      }
      continue;
    }
    if (page === "tabswitch") {
      if (!addon) continue;
      // Default settings for every tool, nothing turned off. The warm-up run (-1) covers the first load after install, and the timed runs are warm.
      result.meta.tabswitch = { next_key: NEXT_TAB_KEY[tool], retry_ms: RETRY_MS, cache: "server sends cache-control: no-store, so each tab load fetches the page again; the browser start-up cache and the extension's script cache are warm after run -1", settings: "extension defaults", early_keys: "DesertFox holds keys that arrive before its keymap is read and replays them. How Vimium, Vimium C and Tridactyl treat early keys was not checked, so a press count for them is presses sent before landing, not proven lost presses" };
      for (let run = -1; run < timed_runs; run++) {
        if (!(await open_page(`${base_url}/tab`)).loaded) throw new Error("the start tab did not load");
        await sleep(1500);
        const tabswitch = await tab_switch_run(NEXT_TAB_KEY[tool]);
        result.runs.push({ page, run, tabswitch });
        log_row({ page, run, first_hop_ms: tabswitch.first_hop_ms, arrive_to_land_ms: tabswitch.arrive_to_land_ms, lost: tabswitch.lost_before_landing, press_gap_ms: tabswitch.press_gap_ms, extra_hops: tabswitch.extra_hops });
      }
      continue;
    }
    // Run -1 is a warm-up. It stays in the data as the first press on this page in this browser process (only the first page of a tool starts in a fresh browser), and the analysis leaves it out of the medians.
    for (let run = -1; run < timed_runs; run++) {
      const { page_state, loaded } = await open_page(`${base_url}/${page}`);
      if (!loaded) { result.runs.push({ page, run, error: "not loaded", page_state }); continue; }
      await sleep(1500);
      await chrome(`(async () => { ${selected_browser}.focus(); return 1; })()`);
      const run_record = { page, run, dcl: page_state.dcl, load: page_state.load };
      run_record.mem_load = await memory();
      if (page === "coverage") {
        // Not timed: the press is made once the extension has settled, and the labels are read after settle_ms.
        if (addon) {
          const reply = await ask_page("coverage", { char: "f", settle_ms: 3000 }, 20000);
          if (reply.error) throw new Error(`coverage press failed: ${reply.error}`);
          if (reply.labels.length === 0) throw new CheckFailed("coverage press drew no labels: the key did not reach the tool");
          const match = match_labels(reply.labels, reply.targets);
          run_record.coverage = { ...reply, ...match };
          // A duplicate or stray label means the labelled-target count cannot be trusted, so the run fails instead of reporting it.
          if (match.duplicates > 0 || match.stray > 0) throw new CheckFailed(`coverage labels do not match the targets one to one: ${match.duplicates} duplicate, ${match.stray} stray`);
        }
        await ask_page("escape");
      } else if (page !== "frames0") {
        if (!addon) {
          await sleep(1000);
          run_record.mem_hints = await memory();
          result.runs.push(run_record);
          continue;
        }
        const press = { char: "f", timeout_ms: 8000, settle_ms: 600 };
        run_record.press1 = await ask_page("press", press, 20000);
        await sleep(1500);
        run_record.mem_hints = await memory();
        await ask_page("escape");
        await sleep(600);
        run_record.press2 = await ask_page("press", press, 20000);
        await ask_page("escape");
        await sleep(400);
      }
      result.runs.push(run_record);
      log_row({ page, run, dcl: run_record.dcl, load: run_record.load, first_press_ms: run_record.press1?.first_ms, labels: run_record.press1?.count, second_press_ms: run_record.press2?.first_ms, content_rss: run_record.mem_load.content_rss, ext_rss: run_record.mem_load.ext_rss });
    }
    // The error rows stay in the data for diagnosis. A page with no timed run at all fails the tool, so rivals.mjs retries it.
    if (!result.runs.some((run_record) => run_record.page === page && run_record.run >= 0 && !run_record.error)) throw new Error(`no timed run of ${page} loaded`);
  }
} catch (error) {
  result.error = String(error.stack ?? error);
  console.log("ERR", result.error);
  process.exitCode = error instanceof CheckFailed ? CHECK_FAILED_STATUS : 1;
} finally {
  try { rdp.close(); } catch { /* the connection may already be gone */ }
  await stop_firefox();
  server.close();
}
writeFileSync(`${work_dir}/out/${tool}.p${pass}.json`, JSON.stringify(result, null, 1));
process.exit(process.exitCode ?? 0);
