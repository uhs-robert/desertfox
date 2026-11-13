// One tool alone in a fresh headless Firefox profile, over the pages. Run by rivals.mjs, which sets RIVALS_DIR, PASS and PAGES.
// usage: node run.mjs <tool> [runs]
// Per page it records load times, the time from the hint key to the first label, and the memory of the page and extension processes.
import { connect_rdp, install_temporary_addon, evaluate_in_chrome } from "../../../test/key/rdp.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as create_port_probe } from "node:net";
import { page_body } from "./pages.mjs";
import { DESERTFOX_ID, PAGE_NAMES, PINNED_BUILDS, xpi_path } from "./tools.mjs";

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

// The debugger gives one evaluation 5 s, so a long job stores its result in a chrome global and node polls for it.
async function chrome_long(async_code, limit_ms) {
  const slot = `__rivals_slot_${++slot_count}`;
  await chrome(`(globalThis.${slot} = undefined, (async () => ${async_code})().then((value) => { globalThis.${slot} = JSON.stringify(value ?? null); }, (error) => { globalThis.${slot} = JSON.stringify({ error: String(error) }); }), 1)`);
  const deadline = Date.now() + limit_ms;
  while (Date.now() < deadline) {
    await sleep(150);
    const stored = await chrome(`globalThis.${slot} ?? null`);
    if (typeof stored === "string") {
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

const result = { tool, base_url, firefox: "", meta: {}, runs: [] };
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
    result.meta.permissions = await chrome(`(async () => { const policy = WebExtensionPolicy.getByID(${JSON.stringify(addon.id)}); return policy ? { manifest_version: policy.manifestVersion, active: policy.active, host_all: policy.allowedOrigins.matches("http://127.0.0.1/") } : null; })()`);
    if (!result.meta.permissions?.active) throw new Error(`${tool} is not active after install`);
    if (tool !== "desertfox" && (await policy_addon_state()) !== "absent") throw new Error("the policy-installed DesertFox came back after the install");
    // Close tabs the extension opened (options, welcome pages) and refocus the first.
    await chrome(`(async () => { const tabs = Services.wm.getMostRecentWindow("navigator:browser").gBrowser; while (tabs.tabs.length > 1) tabs.removeTab(tabs.tabs[tabs.tabs.length - 1]); tabs.selectedTab = tabs.tabs[0]; return 1; })()`);
    await sleep(500);
  }
  log_row(result.meta);
  for (const page of page_names) {
    // Run -1 is a warm-up. It stays in the data as the first press on this page in this browser process (only the first page of a tool starts in a fresh browser), and the analysis leaves it out of the medians.
    for (let run = -1; run < timed_runs; run++) {
      await navigate("about:blank");
      await sleep(700);
      await navigate(`${base_url}/${page}`);
      let page_state = null;
      let loaded = false;
      for (let attempt = 0; attempt < 150 && !loaded; attempt++) {
        await sleep(100);
        try {
          await load_frame_script();
          page_state = await ask_page("state");
        } catch { continue; }
        loaded = page_state?.ready === "complete" && page_state.load > 0 && page_state.url.startsWith(base_url);
      }
      if (!loaded) { result.runs.push({ page, run, error: "not loaded", page_state }); continue; }
      await sleep(1500);
      await chrome(`(async () => { ${selected_browser}.focus(); return 1; })()`);
      const run_record = { page, run, dcl: page_state.dcl, load: page_state.load };
      run_record.mem_load = await memory();
      if (page === "coverage") {
        // Not timed: the press is made once the extension has settled, and the labels are read after settle_ms.
        if (addon) run_record.coverage = await ask_page("coverage", { char: "f", settle_ms: 3000 }, 20000);
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
  process.exitCode = 1;
} finally {
  try { rdp.close(); } catch { /* the connection may already be gone */ }
  await stop_firefox();
  server.close();
}
writeFileSync(`${work_dir}/out/${tool}.p${pass}.json`, JSON.stringify(result, null, 1));
process.exit(process.exitCode ?? 0);
