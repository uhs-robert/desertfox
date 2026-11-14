// One tool alone in a fresh headless Firefox profile, over the pages. Run by rivals.mjs, which sets RIVALS_DIR, PASS and PAGES.
// usage: node run.mjs <tool> [runs]
// Per page it records load times, the time from the hint key to the first label, and the memory of the page and extension processes.
import { connect_rdp, install_temporary_addon, evaluate_in_browsing_context, evaluate_in_chrome } from "../../../test/key/rdp.mjs";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as create_port_probe } from "node:net";
import { match_labels } from "./match_labels.mjs";
import { page_body } from "./pages.mjs";
import { as_action, check_names_of, describe_mode_on_load, focus_of, judge_activation, judge_cell_move, judge_escape, judge_frame_activation, judge_frame_hints, judge_frame_leave, describe_mode_after_leave, is_frame_mode, judge_hints, judge_jk_clash, judge_leave, judge_play_pause, judge_scroll, judge_volume, main_scroller, NORMAL_ACTIONS, page_wall, pick_activation, SITES, timed_out, TOOL_KEYS } from "./sites.mjs";
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
// The volume scale silences the sound output only: the media checks read the player's state and volume, which keep their values.
writeFileSync(`${profile_dir}/user.js`, `${readFileSync(`${repo_dir}/test/key/user.js`, "utf8")}\nuser_pref("privacy.reduceTimerPrecision", false);\nuser_pref("media.volume_scale", "0.0");\n`);

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

// The live-site check (PAGES=sites), in the three steps of sites.mjs, on one page load, except for the DesertFox frame branch, which loads the page again.
// A user's key reaches the focused frame because the parent process routes it there. A key made inside the top page's process never reaches a frame of another origin. So every key of this check goes in through the parent process, into the browser window.
// Key names longer than one character are named keys. Uppercase goes out with Shift held, as a typed capital would.
const NAMED_KEY_CODES = { Escape: 27 };
const press_keys = (keys, gap_ms = 80) => chrome_long(`{
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const browser = win.gBrowser.selectedBrowser;
  if (win.document.activeElement !== browser) browser.focus();
  const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  const wait = (ms) => new Promise((resolve) => win.setTimeout(resolve, ms));
  const named_codes = ${JSON.stringify(NAMED_KEY_CODES)};
  for (const key of ${JSON.stringify([...keys])}) {
    tip.beginInputTransactionForTests(win);
    const named = key.length > 1;
    const upper = !named && key !== key.toLowerCase();
    const shift = new win.KeyboardEvent("", { key: "Shift", code: "ShiftLeft", keyCode: 16 });
    if (upper) tip.keydown(shift);
    const event = new win.KeyboardEvent("", named ? { key, code: key, keyCode: named_codes[key] } : { key, code: "Key" + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0), shiftKey: upper });
    tip.keydown(event);
    tip.keyup(event);
    if (upper) tip.keyup(shift);
    await wait(${gap_ms});
  }
  return 1;
}`, 20000);

const current_url = () => chrome(`${selected_browser}.currentURI.spec`);

// The browsing contexts of the selected tab, each with the content process that holds it. A frame of the tools' own pages (moz-extension) is the tool's interface, not the page, so it is left out for every tool alike.
const page_contexts = () => chrome(`(async () => {
  const found = [];
  const walk = (context) => {
    const global = context.currentWindowGlobal;
    if (global && !global.documentURI?.spec.startsWith("moz-extension:")) found.push({ context_id: context.id, pid: global.domProcess?.osPid ?? null, top: !context.parent });
    for (const child of context.children) walk(child);
  };
  walk(${selected_browser}.browsingContext);
  return found;
})()`);

// The chain from the top page down to the frame that holds the focus, which Firefox tracks in the parent process for every origin. Empty when the focus is outside the page.
const focus_contexts = () => chrome(`(async () => {
  const top_id = ${selected_browser}.browsingContext.id;
  const chain = [];
  for (let context = Services.focus.focusedContentBrowsingContext; context; context = context.parent) chain.unshift({ context_id: context.id, pid: context.currentWindowGlobal?.domProcess?.osPid ?? null });
  return chain.length > 0 && chain[0].context_id === top_id ? chain : [];
})()`);

// The readers below run in the content process that holds a frame, given the frame's window. Each is passed as source, so it must not use anything outside itself.
function read_focused_element(frame_window) {
  const doc = frame_window.document;
  const el = doc.activeElement;
  if (!el) return { tag: "none" };
  return { tag: el.localName, id: el.id, type: el.localName === "input" ? (el.type || "text").toLowerCase() : null, editable: el.isContentEditable, design_mode: doc.designMode === "on", read_only: Boolean(el.readOnly), disabled: Boolean(el.disabled) };
}
// The probe lives on the process console's global between the arm and the read.
function arm_probe(frame_window) {
  const seen = { reached: false, prevented: false };
  const on_key = (event) => { seen.reached = true; seen.prevented = event.defaultPrevented; };
  frame_window.addEventListener("keydown", on_key, true);
  globalThis.__rivals_probe = { frame_window, on_key, seen };
  return 1;
}
function read_probe() {
  const probe = globalThis.__rivals_probe;
  if (!probe) return null;
  probe.frame_window.removeEventListener("keydown", probe.on_key, true);
  delete globalThis.__rivals_probe;
  return probe.seen;
}
// The texts of the visible labels in one frame, in document order: the count is their number, and the frame branch types the first.
function visible_label_texts(frame_window, selectors) {
  const texts = [];
  const visit = (node) => {
    if (node.nodeType !== 1) return;
    if (selectors.some((selector) => node.matches(selector))) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < frame_window.innerHeight && rect.left < frame_window.innerWidth && node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) texts.push(node.textContent.trim());
    }
    const root = node.openOrClosedShadowRoot;
    if (root) for (const child of root.children) visit(child);
    for (const child of node.children) visit(child);
  };
  if (frame_window.document.documentElement) visit(frame_window.document.documentElement);
  return texts;
}
// A click or a focus on an element of the frame, seen before the page's own handlers. The label's own element is DesertFox's or a rival's, so it is not a reaction.
function arm_frame_reaction(frame_window, selectors) {
  const seen = { event: null, tag: null };
  const on_event = (event) => {
    const element = event.target;
    if (!element?.localName || selectors.some((selector) => element.matches?.(selector) || element.closest?.(selector))) return;
    if (!seen.event) { seen.event = event.type; seen.tag = element.localName; }
  };
  frame_window.addEventListener("click", on_event, true);
  frame_window.addEventListener("focusin", on_event, true);
  globalThis.__rivals_reaction = { frame_window, on_event, seen };
  return 1;
}
function read_frame_reaction() {
  const armed = globalThis.__rivals_reaction;
  if (!armed) return null;
  armed.frame_window.removeEventListener("click", armed.on_event, true);
  armed.frame_window.removeEventListener("focusin", armed.on_event, true);
  delete globalThis.__rivals_reaction;
  return armed.seen;
}
// The same label classes as framescript.js.
const HINT_SELECTORS = [".desertfox-hint", ".vimiumHintMarker", ".LH", ".TridactylHint"];

const in_context = (context, reader, ...args) => evaluate_in_browsing_context(rdp, context, `(frame_window) => (${reader})(frame_window, ...${JSON.stringify(args)})`);

async function focus_now() {
  try {
    const chain = [];
    for (const context of await focus_contexts()) {
      const facts = context.pid ? await in_context(context, read_focused_element) : null;
      if (!facts || facts.error) return { ...focus_of(null), path: `unreadable (${facts?.error ?? "frame gone"})` };
      chain.push(facts);
    }
    return focus_of(chain);
  } catch (error) {
    return { ...focus_of(null), path: `unreadable (${String(error.message ?? error).slice(0, 120)})` };
  }
}

// What the tool's scroll key did in the focused document: whether the page saw it after the tool's own capture listener had its turn.
async function probe_mode(keys) {
  const focused = (await focus_contexts()).at(-1);
  if (!focused?.pid) return null;
  await in_context(focused, arm_probe);
  await press_keys(keys);
  await sleep(300);
  const seen = await in_context(focused, read_probe);
  return seen?.error ? null : seen;
}

// Visible labels in every frame of the tab, or in every frame but the top page. A frame the rig could not read is counted, so a zero is never claimed for it.
async function count_labels({ frames_only }) {
  let labels = 0, unread = 0;
  for (const context of await page_contexts()) {
    if (frames_only && context.top) continue;
    // Null means the frame closed before the read, which leaves nothing to count.
    const count = context.pid ? await in_context(context, visible_label_texts, HINT_SELECTORS).catch((error) => ({ error: String(error) })) : { error: "no content process" };
    if (Array.isArray(count)) labels += count.length;
    else if (count !== null) unread++;
  }
  return { labels, unread };
}

// The baseline is read just before the key, so a page that moved on its own before it does not count.
async function scroll_check(keys) {
  const focus = await focus_now();
  const baseline = await ask_page("scroll_baseline", {}, 10000);
  await press_keys(keys);
  await sleep(1000);
  const after = await ask_page("scroll_now", {}, 5000);
  const main = main_scroller(baseline.candidates, baseline.viewport_area);
  return { window_dy: after.window_y - baseline.window_y, main_dy: main ? after.tops[main.index] - main.top : 0, main: main?.name ?? null, active: focus.path };
}

// A wall (consent, bot check, login) is not a fail of the tool, so every check of the site takes the wall's status. A check that throws is an error, not a fail.
// open_page polls every 100 ms, so a live page gets about 30 s to load.
const LIVE_LOAD_ATTEMPTS = 300;
const RENDER_MS = 5000;

// Loads the url, lets an app render after the load event, and returns what the page shows. A page that never completes still gets its checks.
async function load_live(url) {
  const { page_state, loaded } = await open_page(url, LIVE_LOAD_ATTEMPTS);
  if (!page_state) return null;
  await sleep(RENDER_MS);
  await chrome(`(async () => { ${selected_browser}.focus(); return 1; })()`);
  // A page that swapped its content process has lost the frame script, so a first miss loads it again.
  const info = await ask_page("page_info", {}, 5000).catch(async () => { await load_frame_script(); return ask_page("page_info", {}, 5000); });
  return { loaded, info };
}

async function check_site(site) {
  const keys = TOOL_KEYS[tool];
  const url = site.url ?? `${base_url}/${site.path}`;
  const check_names = check_names_of(site, tool);
  const error_record = (reason) => ({ url, checks: Object.fromEntries(check_names.map((name) => [name, { status: "error", reason }])) });
  const page = await load_live(url);
  if (!page) return error_record("the page never answered");
  const record = { url, loaded: page.loaded, landed_url: page.info.url, title: page.info.title, checks: {} };
  const wall = page_wall(page.info);
  if (wall) { for (const name of check_names) record.checks[name] = wall; return record; }
  let shown = null;
  const run_check = async (name, check) => {
    try { record.checks[name] = await check(); }
    catch (error) { record.checks[name] = { status: "error", reason: String(error.message ?? error).slice(0, 200) }; }
  };

  let frame_shown_texts = [];
  async function run_frame_branch() {
    // gF goes first, on the load the leave step used, as a user presses it. Later steps dismiss the popup, and a reload for gF would test a page the user never meets.
    await run_check("frame_leave", async () => {
      await press_keys("gF");
      await sleep(800);
      return judge_frame_leave({ mode_after: await frame_mode_now(), focus_after: await focus_now() });
    });
    // gF left the frame. Loading the page again brings the frame back for the checks inside it.
    await load_live(url);
    if (!is_frame_mode(await frame_mode_now())) {
      for (const name of ["frame_hints", "frame_activate"]) record.checks[name] = { status: "unknown", reason: "the frame did not come back after gF and a reload" };
      return;
    }
    await run_check("frame_hints", async () => {
      await press_keys(keys.hint);
      await sleep(1500);
      const focused = (await focus_contexts()).at(-1);
      frame_shown_texts = focused?.pid ? await in_context(focused, visible_label_texts, HINT_SELECTORS).catch(() => []) : [];
      const top_labels = await ask_page("top_labels", {}, 5000);
      const in_frames = await count_labels({ frames_only: true });
      return judge_frame_hints({ frame_labels: in_frames.labels, top_labels });
    });
    await run_check("frame_activate", async () => {
      const focused = (await focus_contexts()).at(-1);
      const typed = frame_shown_texts.find((text) => text)?.toLowerCase();
      if (!typed || !focused?.pid) return { status: "fail", reason: "no label in the frame to type" };
      await in_context(focused, arm_frame_reaction, HINT_SELECTORS);
      await press_keys(typed);
      await sleep(2500);
      const reply = await in_context(focused, read_frame_reaction).catch(() => null);
      const context_gone = !(await page_contexts()).some((context) => context.context_id === focused.context_id);
      return { ...judge_frame_activation({ reply: reply?.error ? null : reply, context_gone }), typed };
    });
    // A dismissed popup leaves no frame, so the page loads again for step 3.
    if (!is_frame_mode(await frame_mode_now())) await load_live(url);
    shown = null;
  }

  // Step 1. Every tool gets the same probe key, DesertFox too, so all four meet the same page in step 2.
  await run_check("mode_on_load", async () => {
    const focus = await focus_now();
    const desertfox_mode = tool === "desertfox" ? await ask_page("desertfox_mode", {}, 5000) : null;
    const probe = await probe_mode(keys.scroll_down);
    return { ...describe_mode_on_load({ focus, probe, desertfox_mode }), focus, probe };
  });

  // Step 2.
  await run_check("leave", async () => {
    const before = await focus_now();
    await press_keys(["Escape"]);
    await sleep(600);
    const after = await focus_now();
    return { ...judge_leave({ before, after }), before, after };
  });

  // Step 2b, DesertFox only: it reports frame mode after the leave step when the site focused a frame.
  const frame_mode_now = async () => (tool === "desertfox" ? ask_page("desertfox_mode", {}, 5000) : null);
  if (tool === "desertfox") {
    await run_check("mode_after_leave", async () => describe_mode_after_leave({ focus: await focus_now(), badge_label: await frame_mode_now() }));
    if (is_frame_mode(await frame_mode_now())) await run_frame_branch();
  }

  // Step 3.
  const no_key = { status: "fail", reason: "no default key" };
  const press_and_compare = async (key, read, judge, wait_ms) => {
    if (!key) return no_key;
    const before = await ask_page(read, {}, 5000);
    await press_keys(key);
    await sleep(wait_ms);
    return judge(before, await ask_page(read, {}, 5000));
  };
  // The embedded player answers once YouTube's iframe API has loaded it.
  const wait_for_embed = async () => {
    for (let waited = 0; waited < 20000; waited += 500) { if (await ask_page("embed_state", {}, 5000)) return; await sleep(500); }
  };
  const show_hints = async () => {
    const targets = await ask_page("hint_targets", {}, 10000);
    await press_keys(keys.hint);
    await sleep(1500);
    const labels = await ask_page("top_labels", {}, 5000);
    const in_frames = await count_labels({ frames_only: true });
    return { labels, targets, frame_labels: in_frames.labels };
  };
  const actions = {
    play_pause: () => press_and_compare(keys.play_pause, "video_state", judge_play_pause, 1500),
    volume: () => press_and_compare(keys.volume_down, "video_state", judge_volume, 1000),
    cell_move: () => press_and_compare(keys.scroll_down, "name_box", judge_cell_move, 1000),
    jk_clash: async () => {
      const post_before = await ask_page("post_focus", {}, 5000);
      const scroll = await scroll_check(keys.scroll_down);
      const post_after = await ask_page("post_focus", {}, 5000);
      return judge_jk_clash({ scrolled: judge_scroll(scroll).status === "pass", post_focus_moved: post_after !== null && post_after !== post_before });
    },
    embed_play_pause: async () => { await wait_for_embed(); return press_and_compare(keys.play_pause, "embed_state", judge_play_pause, 2500); },
    embed_volume: () => press_and_compare(keys.volume_down, "embed_state", judge_volume, 1500),
    scroll: async () => judge_scroll(await scroll_check(keys.scroll_down)),
    hints: async () => { shown = await show_hints(); return judge_hints(shown.labels, shown.targets, shown.frame_labels); },
    hints_escape: async () => {
      if (!shown?.labels.length && !shown?.frame_labels) return { status: "fail", reason: "no labels to leave" };
      await press_keys(["Escape"]);
      await sleep(800);
      const left = await count_labels({ frames_only: false });
      return judge_escape(left.labels, left.unread);
    },
    activate: async () => {
      const again = await show_hints();
      const pick = pick_activation(again.labels, again.targets);
      if (!pick) return { status: "fail", reason: "no label on a visible target to type" };
      const armed = await ask_page("arm_activation", { target: pick.target }, 5000);
      const url_before = await current_url();
      await press_keys(pick.keys);
      await sleep(3000);
      // A navigation into another content process takes the frame script's state with it, and then only the address can tell.
      const seen = await ask_page("activation_result", {}, 5000).catch(() => null);
      const url_after = await current_url();
      return { ...judge_activation({ event: null, navigated: false, ...seen, expected_href: armed.expected_href, url_before, url_after }), typed: pick.keys, target: armed.tag };
    },
  };
  for (const name of [...site.extra, ...NORMAL_ACTIONS]) await run_check(name, async () => as_action(await actions[name]()));
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
        const run_site = () => check_site(site).catch((error) => ({ url: site.url ?? site.path, checks: Object.fromEntries(check_names_of(site, tool).map((name) => [name, { status: "error", reason: String(error.message ?? error).slice(0, 200) }])) }));
        let record = await run_site();
        // A timeout says nothing about the tool, so the site runs once more. The first record stays in the data, marked, and the table scores the retry.
        if (timed_out(record)) {
          result.runs.push({ page, run: 0, site: site.name, ...record, retried: true });
          log_row({ site: site.name, retried: "a check timed out" });
          record = await run_site();
        }
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
