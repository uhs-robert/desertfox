// The key test: real key presses in a nested session, results read from pages that report to a local server.
// Needs SHADOW_SH, a script with `up|spawn|keys|down <name>` subcommands for a nested, invisible compositor.
// `status` is optional. The sweep reads its stdout for lines that start `<name>: ` and skips the sweep if the verb fails.
// The cleanup of killed runs works only for drivers that keep sessions in /tmp/shadow-<uid>-<name>.
import { execFile, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connect_rdp, evaluate_in_background, evaluate_in_chrome, install_temporary_addon } from "./rdp.mjs";
import { start_server } from "./server.mjs";
import { default_timings_path } from "./timings.mjs";

const run_execfile = promisify(execFile);
const key_test_dir = dirname(fileURLToPath(import.meta.url));
const repo_dir = resolve(key_test_dir, "../..");
const dist_dir = join(repo_dir, "dist");
const EXTENSION_ID = "desertfox@uhs-robert";
const PADDED_BUNDLE_BYTES = 20 * 1024;

const shadow_sh = process.env.SHADOW_SH;
if (!shadow_sh) {
  console.error("key-test: set SHADOW_SH to a script that runs `<script> {up|spawn|keys|down} <name> ...` in a nested session, and optionally `status` (lines `<name>: up|down ...`).");
  process.exit(2);
}

const raw_sleep = (ms) => new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms));
const shadow = (...args) => run_execfile(shadow_sh, args, { maxBuffer: 1 << 24 });
// The pause lets a switched-to tab take keyboard focus before the next press.
const KEY_SETTLE_MS = 350;

export const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
export const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
export const SHIFT_ESCAPE = ["-M", "shift", "-k", "Escape", "-m", "shift"];

// The last resort of a run that fails outside the session, such as before it exists.
export const shadow_down = (name) => shadow("down", name);

function process_is_alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// shadow.sh keeps a session's runtime dir here (a literal /tmp, not TMPDIR), and `down` removes the dir with the marker in it.
const OWNER_MARKER = "desertfox-key-owner";
const marker_path = (name) => join("/tmp", `shadow-${process.getuid()}-${name}`, OWNER_MARKER);

function read_owner_pid(name) {
  try {
    const text = readFileSync(marker_path(name), "utf8").trim();
    return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : undefined;
  } catch {
    return undefined;
  }
}

// A killed run leaves its session behind. Stop each session whose marker names a dead owner.
// A live run is never touched. This run's own pid counts as dead, since a recycled pid can match an old leftover.
// A session with no marker is skipped, whatever its name. That includes one killed between `up` and the marker write, which errs toward safety.
async function sweep_dead_sessions() {
  let stdout;
  try {
    ({ stdout } = await shadow("status"));
  } catch (error) {
    console.error(`sweep skipped: shadow status failed: ${error.message}`);
    return;
  }
  for (const [, name] of stdout.matchAll(/^([a-z0-9][a-z0-9-]*): /gm)) {
    const owner_pid = read_owner_pid(name);
    if (!Number.isInteger(owner_pid) || (owner_pid !== process.pid && process_is_alive(owner_pid))) continue;
    console.log(`sweep: stopping ${name}, left by dead run ${owner_pid}`);
    await shadow("down", name).catch((error) => console.error(`sweep: down ${name} failed: ${error.message}`));
  }
}

async function free_port() {
  const probe = net.createServer();
  await new Promise((resolve_listen) => probe.listen(0, "127.0.0.1", resolve_listen));
  const { port } = probe.address();
  await new Promise((resolve_close) => probe.close(resolve_close));
  return port;
}

// Runs the real install script into the session's throwaway HOME. A curl stand-in copies the host from this checkout, so the run needs no network and tests this branch's host.
function install_native_host(work_dir, session_home) {
  // realpath and the passwd entry catch a HOME override on this runner and a session HOME that links to the real one.
  const real_homes = new Set([homedir(), userInfo().homedir].map((home) => realpathSync(home)));
  if (session_home === "" || real_homes.has(realpathSync(session_home))) throw new Error(`refusing a host install into the real HOME: "${session_home}"`);
  const stub_dir = join(work_dir, "install_stub");
  mkdirSync(stub_dir, { recursive: true });
  writeFileSync(join(stub_dir, "curl"), `#!/bin/sh\nout=""; url=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2;; http*) url=$1; shift;; *) shift;; esac; done\nexec cp "${join(repo_dir, "host")}/$(basename "$url")" "$out"\n`);
  chmodSync(join(stub_dir, "curl"), 0o755);
  const { XDG_DATA_HOME: _ignored, ...env } = process.env;
  const result = spawnSync("sh", [join(repo_dir, "host", "install.sh"), "main"], { env: { ...env, HOME: session_home, PATH: `${stub_dir}:${process.env.PATH}` }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`host install failed: ${result.stderr}${result.stdout}`);
}

function build_test_config(config_dir, out_file) {
  const result = spawnSync("node", ["tools/build-config/cli.ts", config_dir, "--out", out_file], { cwd: repo_dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`build-config failed: ${result.stderr}${result.stdout}`);
}

// Valid script text of about PADDED_BUNDLE_BYTES, so the bundle timings include a real parse and run.
function padded_bundle_text() {
  const lines = [];
  let size = 0;
  for (let index = 0; size < PADDED_BUNDLE_BYTES; index++) {
    const line = `function pad_${index}(left, right) { return left * ${index} + right; }`;
    lines.push(line);
    size += line.length + 1;
  }
  return `(() => {\n${lines.join("\n")}\n})();\n`;
}

// One nested Firefox, its page server and its helpers. `timings` is the run's timing recorder from create_timings.
export async function create_session({ name: shadow_name, timings }) {
  const results = [];
  const measurements = {};
  const sleep = (ms) => timings.time("sleeps", () => raw_sleep(ms));
  const timed_shadow = (...args) => timings.time("driver", () => shadow(...args));
  async function send_keys(...wtype_args) {
    await timings.time("keys", () => shadow("keys", shadow_name, ...wtype_args));
    await timings.time("settle", () => raw_sleep(KEY_SETTLE_MS));
  }

  // KEY_TEST_ONLY=<regex> runs only the cases whose name matches, for a quick repro.
  // A case passed { setup: true } leaves state that later cases read (a reloaded config, an open page,
  // the command history), so it runs under any filter and is reported as "SETUP".
  const is_selected = (name) => !process.env.KEY_TEST_ONLY || new RegExp(process.env.KEY_TEST_ONLY).test(name);
  async function run_case(name, body, { setup = false } = {}) {
    const selected = is_selected(name);
    if (!selected && !setup) return;
    const label = selected ? "" : "SETUP ";
    await timings.time_case(name, { setup: !selected }, async () => {
      try {
        await body();
        results.push({ name, pass: true, setup: !selected });
        console.log(`${label}PASS ${name}`);
      } catch (error) {
        results.push({ name, pass: false, reason: error.message, setup: !selected });
        console.log(`${label}FAIL ${name}: ${error.message}`);
      }
    });
  }

  function expect(condition, message) {
    if (!condition) throw new Error(message);
  }
  const work_dir = mkdtempSync(join(tmpdir(), "desertfox-key-"));
  const profile_dir = join(work_dir, "profile");
  const managed_dir = join(work_dir, "managed");
  const config_dir = join(work_dir, "config");
  cpSync(join(key_test_dir, "config"), config_dir, { recursive: true });
  mkdirSync(profile_dir);
  cpSync(join(key_test_dir, "user.js"), join(profile_dir, "user.js"), { recursive: true });
  const managed_file = join(managed_dir, `${EXTENSION_ID}.json`);
  // DESERTFOX_CONFIG_DIR points the native host here (launch_firefox.sh). load_config_dir moves the link.
  const active_config = join(work_dir, "active_config");
  symlinkSync(config_dir, active_config);
  const server = await start_server();
  // The built-in duck engine is replaced by this server, so a search from the keys lands on a page the test can read.
  // The keyfam.site engine is for p9_completion.mjs. The keysite, keyrepo, keysub, keypage, keyhere and keyother engines are for p8_engines.mjs (keyhere belongs to the test host, keyother to a host no test page has): the test page has a host but is no GitHub repo or subreddit.
  const engine_url = (id, slot) => `http://127.0.0.1:${server.port}/page?id=${id}&q=${slot}+{query}`;
  writeFileSync(
    join(config_dir, "search_engines.toml"),
    [
      `duck = { url = "http://127.0.0.1:${server.port}/page?id=search_result&q=%s", label = "Test server" }`,
      `[keysite]\nlabel = "Key site"\nurl = "${engine_url("engine_site", "{host}")}"`,
      `[keyrepo]\nlabel = "Key repo"\nurl = "${engine_url("engine_repo", "{repo}")}"`,
      `[keysub]\nlabel = "Key sub"\nurl = "${engine_url("engine_sub", "{subreddit}")}"\nfallback = "duck"`,
      `[keypage]\nlabel = "Key page"\nurl = "http://127.0.0.1:${server.port}/page?id=engine_page&q={query|url}"`,
      `[keyhere]\nlabel = "Key here"\nhosts = ["127.0.0.1"]\nurl = "${engine_url("engine_here", "{host}")}"`,
      `[keyother]\nlabel = "Key other"\nhosts = ["other.invalid"]\nurl = "${engine_url("engine_other", "{host}")}"`,
      `[keyfam]\nlabel = "Key family"\nurl = "${engine_url("engine_family", "{host}")}"`,
      `[keyfam.site]\nlabel = "Key family: site"\nurl = "${engine_url("engine_family", "{host}")}"`,
      "",
    ].join("\n"),
  );
  // Written here, not kept in config/, because a copy of config/ has no engines and a site key must name real ones. h picks keyhere on the test host, n has an engine for another host only.
  writeFileSync(join(config_dir, "keymap.d", "80-site.toml"), '[site_keys]\nh = ["keyother", "keyhere"]\nn = ["keyother"]\n');
  build_test_config(config_dir, managed_file);
  const events = server.events;
  const debug_port = await free_port();
  let rdp;
  // A signal can arrive during the normal teardown, so every path shares this one run of the cleanup.
  let teardown_started;
  const teardown = () => {
    teardown_started ??= (async () => {
      rdp?.close();
      await shadow("down", shadow_name).catch((error) => console.error(`shadow down failed: ${error.message}`));
      server.close();
      rmSync(work_dir, { recursive: true, force: true });
    })();
    return teardown_started;
  };
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.on(signal, () => {
      // Written before the teardown, so a hung teardown loses nothing and is not charged to the case.
      timings.finish_active_case();
      write_timings();
      teardown().finally(() => process.exit(code));
    });
  }

  const url_of = (kind, id) => `http://127.0.0.1:${server.port}/${kind}?id=${id}`;
  const since = (mark) => events.slice(mark);
  const find_event = (mark, predicate) => since(mark).find(predicate);
  const wait_event = (...args) => timings.time("waits", () => wait_event_untimed(...args));
  async function wait_event_untimed(mark, predicate, what, timeout_ms = 8000) {
    const deadline = Date.now() + timeout_ms;
    for (;;) {
      const found = find_event(mark, predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await raw_sleep(50);
    }
  }
  const became_visible = (page_id) => (event) => event.type === "visibility" && event.state === "visible" && event.page_id === page_id;
  const visible_events = (mark) => since(mark).filter((event) => event.type === "visibility" && event.state === "visible");
  const scroll_of = (page_id) => (event) => event.type === "scroll" && event.page_id === page_id;
  const last_scroll_y = (page_id) => events.filter(scroll_of(page_id)).at(-1)?.y ?? 0;

  const open_page = (...args) => timings.time("page_opens", () => open_page_untimed(...args));
  async function open_page_untimed(kind, id, { new_tab }) {
    const mark = events.length;
    if (new_tab) {
      await send_keys(...CTRL("t"));
      await sleep(500);
    }
    // A lost keystroke in the address bar leaves the page unloaded, so one retry keeps the test steady.
    for (let attempt = 0; ; attempt++) {
      await send_keys(...CTRL("l"), "-d", "5", url_of(kind, id), "-k", "Return");
      try {
        await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 6000);
        break;
      } catch (error) {
        if (attempt >= 1) throw error;
        measurements.navigation_retries = (measurements.navigation_retries ?? 0) + 1;
      }
    }
    await sleep(150);
  }

  async function scroll_delta_after(page_id, keys) {
    const before = last_scroll_y(page_id);
    const mark = events.length;
    await send_keys(...keys);
    const reported = await wait_event(mark, scroll_of(page_id), `scroll on ${page_id} after ${keys.join(" ")}`);
    return reported.y - before;
  }

  async function expect_no_scroll(mark, page_id) {
    await sleep(700);
    expect(!find_event(mark, scroll_of(page_id)), `page ${page_id} scrolled`);
  }

  // The active tab comes from the background, so a switch that landed on the wrong tab fails by name. A page report cannot say that.
  async function expect_exactly_one_visible(mark, expected_page_id) {
    await sleep(1500);
    const active_url = await evaluate_in_background(rdp, EXTENSION_ID, `browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.url)`);
    expect(String(active_url).endsWith(`id=${expected_page_id}`), `expected the active tab to be ${expected_page_id}, it is ${active_url}`);
    const visible = visible_events(mark);
    expect(visible.length <= 1, `expected one switch to ${expected_page_id}, saw [${visible.map((event) => event.page_id).join(", ")}]`);
  }

  const timings_path = default_timings_path(repo_dir);
  // Called after each piece, from the signal path and at the end, so a run killed at the time cap still leaves its numbers. A failed write must not hide the run's own error.
  function write_timings({ print_summary = true } = {}) {
    try {
      const timings_report = timings.report();
      timings.write_json(timings_path, timings_report);
      if (!print_summary) return;
      console.log(timings.summary_text(timings_report));
      console.log(`key-test timings written to ${timings_path}`);
    } catch (error) {
      console.error(`key-test timings not written: ${error.message}`);
    }
  }

  // Piled-up tabs may slow later steps, so the count is sampled between pieces. A failed sample is recorded as null.
  async function sample_tabs(label) {
    const tab_count = await evaluate_in_background(rdp, EXTENSION_ID, `browser.tabs.query({}).then((tabs) => tabs.length)`).catch(() => null);
    timings.record_tab_count(label, tab_count);
  }

  try {
    await sweep_dead_sessions();
    await timed_shadow("up", shadow_name);
    // A driver that keeps sessions elsewhere has no such dir. Its sessions are never swept, which is safe.
    if (existsSync(dirname(marker_path(shadow_name)))) writeFileSync(marker_path(shadow_name), String(process.pid));
    else console.error(`no runtime dir for ${shadow_name} under /tmp: skipping the owner marker, so a killed run's session will not be swept`);
    await timed_shadow("spawn", shadow_name, join(key_test_dir, "launch_firefox.sh"), work_dir, profile_dir, String(debug_port), managed_file);
    for (let attempt = 0; ; attempt++) {
      try {
        rdp = timings.wrap_rdp(await connect_rdp(debug_port));
        break;
      } catch (error) {
        if (attempt > 60) throw new Error(`Firefox debugger never answered: ${error.message}`);
        await sleep(500);
      }
    }
    // The padded bundles stand in for a 20 KB hints or caret bundle. They go into a copy, so dist/ stays as built.
    const extension_dir = join(work_dir, "extension");
    cpSync(dist_dir, extension_dir, { recursive: true });
    // The caret bundle keeps its real code and gains the padding after it, so the caret cases run the real sinks. The which-key bundle stays real.
    writeFileSync(join(extension_dir, "caret.js"), readFileSync(join(dist_dir, "caret.js"), "utf8") + padded_bundle_text());
    await install_temporary_addon(rdp, extension_dir);
    // The first new tab of the extension's page shows Firefox's "Your new tab has changed" notice. Once shown, its closed
    // panel keeps the access key K of "Keep Changes" for the session, and that eats Alt+K on pages Firefox draws itself,
    // such as about:support. Confirming the notice the way "Keep Changes" does keeps it from ever showing.
    const notice_confirmation = await evaluate_in_chrome(rdp, `(async () => {
      const { ExtensionSettingsStore } = ChromeUtils.importESModule("resource://gre/modules/ExtensionSettingsStore.sys.mjs");
      await ExtensionSettingsStore.initialize();
      await ExtensionSettingsStore.addSetting("${EXTENSION_ID}", "newTabNotification", "${EXTENSION_ID}", true, () => false);
    })()`);
    if (notice_confirmation?.error) throw new Error(`confirming the new tab notice failed: ${notice_confirmation.error}`);
    // config.reload reads the files through the native host. Firefox grants nativeMessaging only from a click, so the test grants it from chrome code.
    install_native_host(work_dir, readFileSync(join(work_dir, "session_home"), "utf8").trim());
    const permission_grant = await evaluate_in_chrome(rdp, `(async () => {
      const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
      // The third argument tells the running extension, as permissions.request does, so its background gains sendNativeMessage at once.
      const { extension } = WebExtensionPolicy.getByID("${EXTENSION_ID}");
      await ExtensionPermissions.add("${EXTENSION_ID}", { permissions: ["nativeMessaging"], origins: [] }, extension);
    })()`);
    if (permission_grant?.error) throw new Error(`granting nativeMessaging failed: ${permission_grant.error}`);
    const native_api = await evaluate_in_background(rdp, EXTENSION_ID, `typeof browser.runtime.sendNativeMessage`);
    if (native_api !== "function") throw new Error(`the background has no sendNativeMessage after the grant: ${native_api}`);
    await sleep(1500);
  } catch (error) {
    await close();
    throw error;
  }

  const read_injections = async (file) => {
    const all = await evaluate_in_background(rdp, EXTENSION_ID, `(async () => (await browser.storage.local.get("desertfox_bundle_loads")).desertfox_bundle_loads ?? [])()`);
    if (!Array.isArray(all)) throw new Error(`injection log unreadable: ${JSON.stringify(all)}`);
    return all.filter((entry) => entry.file === file);
  };
  // The log is written after the injection answers, so a read can come first. Wait up to 1 s for the expected count.
  const injections_of = async (file, at_least = 0) => {
    let entries = await read_injections(file);
    for (let waited = 0; entries.length < at_least && waited < 1000; waited += 100) {
      await sleep(100);
      entries = await read_injections(file);
    }
    return entries;
  };
  // A write from the previous case may still be on its way, so the baseline is taken after the log holds still.
  const settled_injection_count = async (file) => {
    await sleep(300);
    return (await read_injections(file)).length;
  };

  // The debugger answers null for undefined, so the checks below compare with == null.
  const in_background = (code) => evaluate_in_background(rdp, EXTENSION_ID, code).catch(() => undefined);
  const read_local = (key) => in_background(`(async () => (await browser.storage.local.get("${key}"))["${key}"])()`);
  // Presses qr and waits until the reload stores the files config. The key is removed first, so an earlier reload does not count.
  async function reload_in_place() {
    await in_background(`browser.storage.local.remove("desertfox_files_config")`);
    await send_keys("qr");
    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(250);
      if ((await read_local("desertfox_files_config")) != null) return;
    }
    // The host call made by hand tells a missing permission or host from a refused build.
    const probe = await in_background(`(async () => ({ granted: await browser.permissions.contains({ permissions: ["nativeMessaging"] }), host: await browser.runtime.sendNativeMessage("desertfox_host", { cmd: "read_config" }).then((reply) => ({ ok: reply.ok, error: reply.error, files: Object.keys(reply.files ?? {}).length }), (error) => String(error)) }))()`);
    throw new Error(`qr stored no files config after 10 s: ${JSON.stringify(probe)}`);
  }
  // Waits for the restart that debug.restart starts: the new background writes its tab repair report.
  async function wait_reinject_report() {
    let report;
    for (let attempt = 0; attempt < 60 && !report; attempt++) {
      await sleep(500);
      report = await read_local("desertfox_reinject_report");
    }
    expect(report, "no desertfox_reinject_report after 30 s");
    return report;
  }

  // The pages are extension pages, so the test reads them through the background's view list.
  const extension_view = (name) => `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/${name}"))`;

  // Points the native host at a config folder and reloads it in place with qr. The which-key shots use it to show a copy of the user config.
  let linked_config_dir = config_dir;
  const load_config_dir = async (dir) => {
    rmSync(active_config);
    symlinkSync(dir, active_config);
    // Moving away is recorded at once, so a failed reload still gets restored. Moving back counts only once the reload worked, so a lost qr is retried by the next reset.
    if (dir !== config_dir) linked_config_dir = dir;
    await reload_in_place();
    linked_config_dir = dir;
    await sleep(500);
  };
  // Pieces never write config_dir, so it stays the base config every piece starts from. A piece edits a copy and loads it with load_config_dir.
  let config_copy_count = 0;
  const config_copy = () => {
    const copy_dir = join(work_dir, `config_copy_${++config_copy_count}`);
    cpSync(config_dir, copy_dir, { recursive: true });
    return copy_dir;
  };

  const background_call = async (code) => {
    const value = await evaluate_in_background(rdp, EXTENSION_ID, code);
    if (value?.error) throw new Error(`background call failed: ${value.error}`);
    return value;
  };
  const close_tabs_with = (text) => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);

  // Polls until the check holds. `what` names the wait in the error.
  async function poll_until(what, check, timeout_ms = 10000) {
    const deadline = Date.now() + timeout_ms;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  }

  const read_config_status = () => read_local("desertfox_config_status");

  // The page itself says it holds focus, so a focus that landed in the address bar or another window is caught. document.hasFocus() is false for both.
  const page_has_focus = (tab_id) => in_background(`browser.tabs.executeScript(${tab_id}, { code: "document.hasFocus()" }).then((answers) => answers[0] === true)`);
  // Focus lands in browser chrome after tabs close, and a closed window can leave compositor focus on it. Ask for the window and tab, then use the focus_page chord, until the page reports focus.
  async function confirm_page_focus(tab_id, window_id) {
    const focused = (timeout_ms) => poll_until("page focus", () => page_has_focus(tab_id), timeout_ms).then(() => true, () => false);
    if (await focused(300)) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      await in_background(`(async () => { await browser.windows.update(${window_id}, { focused: true }); await browser.tabs.update(${tab_id}, { active: true }); })()`);
      if (await focused(1500)) return;
      await send_keys(...ALT(","));
      if (await focused(1500)) return;
    }
    throw new Error(`tab ${tab_id} never reported focus`);
  }

  // A bulk tabs.remove of 30 or more tabs outlasts one debugger call, so the close is started and then polled.
  async function wait_for_tabs(what, count_expr, expected) {
    await poll_until(what, async () => (await in_background(count_expr)) === expected, 30000);
  }

  async function close_tabs_outside(keep_tab_ids, keep_window_ids) {
    const kept = await background_call(`(async () => {
      const keep_tabs = new Set(${JSON.stringify(keep_tab_ids)});
      const keep_windows = new Set(${JSON.stringify(keep_window_ids)});
      const windows = await browser.windows.getAll();
      const doomed = windows.filter((window) => !keep_windows.has(window.id));
      // Firefox exits with its last window, so one window survives even when a piece closed the snapshot window.
      if (doomed.length === windows.length) doomed.shift();
      for (const window of doomed) await browser.windows.remove(window.id);
      const tabs = await browser.tabs.query({});
      const extra = tabs.filter((tab) => !keep_tabs.has(tab.id)).map((tab) => tab.id);
      // The last tab stays, because Firefox exits with its last window.
      if (extra.length === tabs.length) extra.shift();
      browser.tabs.remove(extra).catch(() => undefined);
      return tabs.length - extra.length;
    })()`);
    await wait_for_tabs("the extra tabs to close", `browser.tabs.query({}).then((tabs) => tabs.length)`, kept);
  }

  // Focuses the active tab of the last focused window, or any tab when none is active, so a step that types keys has a page to type into.
  async function refocus_any_tab() {
    const target = await background_call(`(async () => {
      const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = active ?? (await browser.tabs.query({}))[0];
      return { id: tab.id, window_id: tab.windowId };
    })()`);
    await confirm_page_focus(target.id, target.window_id);
  }

  // Unsets the temp edits through the command line, which rebuilds the effective config the way a user's :unset does.
  async function clear_temp_settings() {
    if (!((await read_config_status())?.temp?.length > 0)) return;
    await send_keys(":unset -t all", "-k", "Return");
    await poll_until("the temp settings to clear", async () => !((await read_config_status())?.temp?.length > 0), 6000);
  }

  // Puts the config link back on config_dir and reloads it in place. A debug.restart may still be starting the new background, and a qr sent to it is lost, so the status key comes first.
  async function restore_config() {
    if (linked_config_dir === config_dir) return;
    await poll_until("the background to publish its config status", async () => (await read_config_status()) != null, 15000);
    await load_config_dir(config_dir);
    await poll_until("the files config to apply", async () => (await read_config_status())?.source === "files", 10000);
  }

  // Every piece starts from the same state: one window with one tab at home_<piece>, active and focused, on the base config with no temp edits.
  async function reset_for_piece(home_id) {
    const mark = events.length;
    const home = await background_call(`(async () => {
      const keep = await browser.windows.getLastFocused();
      const tab = await browser.tabs.create({ windowId: keep.id, url: ${JSON.stringify(url_of("page", home_id))}, active: true });
      for (const window of await browser.windows.getAll()) if (window.id !== keep.id) await browser.windows.remove(window.id);
      const old = (await browser.tabs.query({})).filter((other) => other.id !== tab.id).map((other) => other.id);
      browser.tabs.remove(old).catch(() => undefined);
      return { tab_id: tab.id, window_id: keep.id };
    })()`);
    await wait_for_tabs("one tab to be left", `browser.tabs.query({}).then((tabs) => tabs.length)`, 1);
    await wait_for_tabs("one window to be left", `browser.windows.getAll().then((windows) => windows.length)`, 1);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === home_id, `content script ready on ${home_id}`, 10000);
    await confirm_page_focus(home.tab_id, home.window_id);
    await restore_config();
    await clear_temp_settings();
    // restore_config and clear_temp_settings type keys, so the page is asked once more.
    await confirm_page_focus(home.tab_id, home.window_id);
    return { tab_ids: [home.tab_id], window_ids: [home.window_id] };
  }

  // Runs after the cases, pass or fail. The teardown callbacks each report their own failure. Close, focus, config restore and temp unset each run in their own try, so a failed close does not skip the config restore.
  async function clean_up_piece(file, state, snapshot) {
    const failed_step = (step, error) => {
      results.push({ name: `${file} ${step}`, pass: false, reason: error.message, setup: false });
      console.log(`FAIL ${file} ${step}: ${error.message}`);
    };
    for (const teardown_step of state.teardowns.reverse()) {
      try {
        await teardown_step();
      } catch (error) {
        failed_step("teardown", error);
      }
    }
    const attempt = async (step, action) => {
      try {
        await action();
      } catch (error) {
        failed_step(step, error);
      }
    };
    await attempt("cleanup close", () => close_tabs_outside(snapshot.tab_ids, snapshot.window_ids));
    await attempt("cleanup focus", refocus_any_tab);
    await attempt("cleanup config restore", async () => {
      await refocus_any_tab();
      await restore_config();
    });
    await attempt("cleanup temp unset", async () => {
      await refocus_any_tab();
      await clear_temp_settings();
    });
  }

  // One context per piece file: the shared helpers plus that piece's own setup steps and teardown list.
  function make_piece(piece_file) {
    const state = { setup_failure: undefined, teardowns: [], marked_failed: 0 };
    async function run_piece_case(name, body, options) {
      if (!state.setup_failure) return run_case(name, body, options);
      if (!is_selected(name)) return;
      state.marked_failed++;
      results.push({ name, pass: false, reason: "setup failed", setup: false });
      console.log(`FAIL ${name}: setup failed`);
    }
    // Runs under any KEY_TEST_ONLY filter, counts in no pass or fail total and is timed as "(setup)". A failure fails the cases behind it.
    async function setup(name, body) {
      if (state.setup_failure) return;
      await timings.time_case("(setup)", { setup: true }, async () => {
        try {
          await body();
          console.log(`SETUP ${name}`);
        } catch (error) {
          state.setup_failure = { name, reason: error.message };
          console.log(`SETUP FAIL ${name}: ${error.message}`);
        }
      });
    }
    // Callbacks run in reverse order when the piece ends, pass or fail.
    const on_teardown = (callback) => state.teardowns.push(callback);
    // The cases of a piece file in test/key/p<number>_*.mjs get these helpers.
    const context = { config_dir, config_copy, load_config_dir, take_shot: (path) => timed_shadow("shot", shadow_name, "--out", path), run_case: run_piece_case, setup, on_teardown, expect, open_page, send_keys, sleep, events, wait_event, since, find_event, url_of, rdp, extension_id: EXTENSION_ID, scroll_delta_after, became_visible, scroll_of, last_scroll_y,
      // Moved out of the run.mjs cases. Pieces may use them too.
      in_background, read_local, reload_in_place, wait_reinject_report, injections_of, settled_injection_count, expect_no_scroll, expect_exactly_one_visible, visible_events, extension_view, close_tabs_with };
    return { context, state, piece_file };
  }

  const context_for = (piece_file) => make_piece(piece_file).context;

  async function run_piece(file, piece_module) {
    const { context, state } = make_piece(file);
    await timings.time_piece(file, async () => {
      await sample_tabs(`before ${file}`);
      let snapshot;
      try {
        snapshot = await reset_for_piece(`home_${file.replace(/\.mjs$/, "")}`);
      } catch (error) {
        results.push({ name: `${file} reset`, pass: false, reason: error.message, setup: false });
        console.log(`FAIL ${file} reset: ${error.message}`);
        return;
      }
      try {
        await piece_module.run_cases(context);
        // A setup step that fails behind no case would otherwise pass unseen.
        if (state.setup_failure && state.marked_failed === 0) {
          results.push({ name: `${file} setup ${state.setup_failure.name}`, pass: false, reason: state.setup_failure.reason, setup: false });
        }
      } finally {
        await clean_up_piece(file, state, snapshot);
        await sample_tabs(`after ${file}`);
      }
    });
    write_timings({ print_summary: false });
  }

  async function close() {
    await teardown();
    console.log(JSON.stringify(measurements));
    write_timings();
  }

  return { context_for, run_piece, results, measurements, sample_tabs, close };
}
