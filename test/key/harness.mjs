// The key test: real key presses in a nested session, results read from pages that report to a local server.
// session.mjs starts the nested session and its keyboard.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect_rdp, evaluate_in_background, evaluate_in_chrome, evaluate_in_page_frames, install_temporary_addon } from "./rdp.mjs";
import { start_server } from "./server.mjs";
import { start_session, stop_session_named, sweep_dead_sessions } from "./session.mjs";
import { create_stall_capture, stall_capture_mode } from "./stall_capture.mjs";
import { check_firefox_internals, with_firefox_version } from "./firefox_internals.mjs";
import { default_timings_path } from "./timings.mjs";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
const repo_dir = resolve(key_test_dir, "../..");
const dist_dir = join(repo_dir, "dist");
const EXTENSION_ID = "desertfox@uhs-robert";
const PADDED_BUNDLE_BYTES = 20 * 1024;

const raw_sleep = (ms) => new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms));
// The pause of send_keys lets a switched-to tab take keyboard focus before the next press. press_keys has none: wait for the key's effect instead.
const KEY_SETTLE_MS = 350;
// A case that runs past this fails by name. Its waits have their own, shorter timeouts, so only a wait with no end reaches it.
const CASE_CAP_MS = 30000;
// The test pages report a scroll this long after it ends (the debounce in the reporter of server.mjs).
const SCROLL_REPORT_DELAY_MS = 150;
// A tab hidden or shown within 150 ms of its opening lost the visibility report of its next switch in 6 of 6 tries, and 200 ms kept it in 6 of 6.
// Only wait_tab_quiet keeps this age, for the extension and about: pages that report no keys. A test page takes the key probe instead.
const NEW_PAGE_QUIET_MS = 300;
const BARRIER_KEY = "F8";
// The probe has its own key, so no barrier check can match a late probe report. F4 has no binding in src/ and no default action in Firefox.
const PROBE_KEY = "F4";
// A key that a young page drops does not come late (7a probe: 40 of 40 such presses stayed unseen for 1 s), so a probe press unseen this long is pressed again.
const KEY_PROBE_TRY_MS = 200;
const KEY_PROBE_TIMEOUT_MS = 3000;
// The which-key delay of the test config, so a check that a panel stays away sits out the timer written in config/settings.toml.
const WHICH_KEY_DELAY_MS = Number(/^which_key_delay_ms\s*=\s*(\d+)/m.exec(readFileSync(join(key_test_dir, "config", "settings.toml"), "utf8"))?.[1]);
if (!Number.isFinite(WHICH_KEY_DELAY_MS)) throw new Error("which_key_delay_ms is missing from test/key/config/settings.toml");
const UNREADY_LINE_WAIT_MS = 500;
// 100 ms polls: 20 s, below CASE_CAP_MS.
const REINJECT_REPORT_POLLS = 200;

export const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
export const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
export const SHIFT_ESCAPE = ["-M", "shift", "-k", "Escape", "-m", "shift"];

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
// `sweep: false` skips the leftover sweep, for a caller that swept once for many sessions. `debug_port` lets that caller pick distinct ports, since two sessions that each probe for a free port can pick the same one.
// `diagnostics_dir` keeps Firefox's output and crash dumps there when the session ends with a failure, since the teardown deletes both. `print_summary: false` leaves the timings summary to the caller. `create_timings_dir: false` skips a write whose folder is gone.
export async function create_session({ name: session_name, timings, sweep = true, debug_port: given_debug_port, diagnostics_dir, print_summary = true, create_timings_dir = true }) {
  const results = [];
  const measurements = {};
  const sleep = (ms) => timings.time("sleeps", () => raw_sleep(ms));
  let session;
  // Set by each key press and cleared by the wait timeout it charges, so one lost key counts once however many waits then fail.
  let pressed_since_timeout = false;
  const press_keys = (...wtype_args) => timings.time("keys", () => {
    pressed_since_timeout = true;
    return session.press(wtype_args);
  });
  async function send_keys(...wtype_args) {
    await press_keys(...wtype_args);
    await timings.time("settle", () => raw_sleep(KEY_SETTLE_MS));
  }

  // The latest wait that started, so a case that hits the cap says what it was waiting for.
  let waiting_for;
  // The body cannot be cancelled, so one that outlives its cap runs on in the background. Its waits end by their own timeouts, and a late failure is logged here and reported nowhere else.
  async function within_case_cap(name, body) {
    let cap_reached = false;
    waiting_for = undefined;
    let cap_timer;
    const running = body();
    running.catch((error) => { if (cap_reached) console.log(`late failure of "${name}" after its cap: ${error.message}`); });
    const capped = new Promise((_, reject) => {
      cap_timer = setTimeout(() => { cap_reached = true; reject(new Error(`ran past the ${CASE_CAP_MS / 1000} s case cap${waiting_for ? ` while waiting for ${waiting_for}` : ""}`)); }, CASE_CAP_MS);
    });
    try {
      return await Promise.race([running, capped]);
    } finally {
      clearTimeout(cap_timer);
    }
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
        // With the browser gone each case would wait out its own timeouts, so the rest of the piece fails at once.
        const lost_before = rdp?.lost_reason();
        if (lost_before) throw new Error(`connection to Firefox lost: ${lost_before}`);
        await within_case_cap(name, body);
        results.push({ name, pass: true, setup: !selected });
        console.log(`${label}PASS ${name}`);
      } catch (error) {
        // A signal tears the session down under the running piece. Its cases then fail on the closed debugger, which says nothing about them.
        if (teardown_started) return;
        // A dead browser fails every wait by timeout, so the lost connection is named on each case it fails.
        const lost = rdp?.lost_reason();
        const reason = lost && !error.message.includes("connection to Firefox lost") ? `${error.message} (connection to Firefox lost: ${lost})` : error.message;
        results.push({ name, pass: false, reason, setup: !selected });
        console.log(`${label}FAIL ${name}: ${reason}`);
      }
    });
  }

  function expect(condition, message) {
    if (!condition) throw new Error(message);
  }
  const work_dir = mkdtempSync(join(tmpdir(), "desertfox-key-"));
  const profile_dir = join(work_dir, "profile");
  const config_dir = join(work_dir, "config");
  cpSync(join(key_test_dir, "config"), config_dir, { recursive: true });
  mkdirSync(profile_dir);
  cpSync(join(key_test_dir, "user.js"), join(profile_dir, "user.js"), { recursive: true });
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
  const events = server.events;
  const debug_port = given_debug_port ?? (await free_port());
  let rdp;
  // Undefined unless KEY_TEST_STALL_CAPTURE=1 and gdb is present. Then Firefox runs under gdb (launch_firefox.sh).
  const launch_mode = stall_capture_mode();
  const stall_capture = launch_mode === "gdb" ? create_stall_capture({ debug_port, gdb_log: join(work_dir, "gdb.log"), out_dir: diagnostics_dir ?? join(repo_dir, ".logs"), label: session_name }) : undefined;
  // A signal can arrive during the normal teardown, so every path shares this one run of the cleanup.
  let teardown_started;
  // Set by close(), so a signal after a finished run only exits and does not write the timings a second time.
  let closed = false;
  // A signal skips the wait for a running capture, since the coordinator is waiting to end the run.
  const teardown = ({ keep_diagnostics, wait_for_capture = true }) => {
    teardown_started ??= (async () => {
      if (wait_for_capture) await stall_capture?.settled();
      if (keep_diagnostics && diagnostics_dir) save_diagnostics();
      rdp?.close();
      // A signal during the start leaves no session object, so the session is found by its name.
      await (session ? session.stop() : stop_session_named(session_name)).catch((error) => console.error(`session stop failed: ${error.message}`));
      server.close();
      rmSync(work_dir, { recursive: true, force: true });
    })();
    return teardown_started;
  };
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.on(signal, () => {
      if (closed) {
        teardown({ keep_diagnostics: false, wait_for_capture: false }).finally(() => process.exit(code));
        return;
      }
      // Written before the teardown, so a hung teardown loses nothing and is not charged to the case.
      timings.finish_active_case();
      timings.finish_active_piece();
      write_timings();
      teardown({ keep_diagnostics: true, wait_for_capture: false }).finally(() => process.exit(code));
    });
  }

  // The session HOME and the profile go with the teardown. spawn.log sits beside the session HOME.
  function save_diagnostics() {
    try {
      mkdirSync(diagnostics_dir, { recursive: true });
      const session_home = readFileSync(join(work_dir, "session_home"), "utf8").trim();
      const kept = [
        [join(dirname(session_home), "logs", "spawn.log"), "spawn.log"],
        [join(profile_dir, "minidumps"), "minidumps"],
        [join(session_home, ".mozilla", "firefox", "Crash Reports"), "crash_reports"],
      ].filter(([from]) => existsSync(from));
      for (const [from, to] of kept) cpSync(from, join(diagnostics_dir, to), { recursive: true });
      console.log(`diagnostics kept in ${diagnostics_dir}: ${kept.map(([, to]) => to).join(", ") || "nothing to keep"}`);
    } catch (error) {
      console.error(`diagnostics not kept: ${error.message}`);
    }
  }

  const url_of = (kind, id) => `http://127.0.0.1:${server.port}/${kind}?id=${id}`;
  const since = (mark) => events.slice(mark);
  const find_event = (mark, predicate) => since(mark).find(predicate);
  // Every wait that times out ends here, so a key press that went missing counts once whichever wait notices.
  function wait_timeout_error(what) {
    if (pressed_since_timeout) timings.record_lost_key_suspect(what);
    pressed_since_timeout = false;
    return new Error(`timed out waiting for ${what}`);
  }
  const wait_event = (...args) => timings.time("waits", () => wait_event_untimed(...args));
  async function wait_event_untimed(mark, predicate, what, timeout_ms = 8000) {
    waiting_for = what;
    const found = await server.wait_for_event(mark, predicate, timeout_ms);
    if (!found) throw wait_timeout_error(what);
    return found;
  }
  const scroll_of = (page_id) => (event) => event.type === "scroll" && event.page_id === page_id;
  const last_scroll_y = (page_id) => events.filter(scroll_of(page_id)).at(-1)?.y ?? 0;

  // The id of the page in the active tab when it is one of this server's pages, otherwise undefined.
  async function active_test_page_id() {
    const active_url = await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab?.url ?? "")`);
    const url = URL.canParse(active_url ?? "") ? new URL(active_url) : undefined;
    return url?.origin === new URL(url_of("page", "x")).origin ? url.searchParams.get("id") ?? undefined : undefined;
  }

  const open_page = (...args) => timings.time("page_opens", () => open_page_untimed(...args));
  // The background opens the page, so the address bar never takes the keys. `new_tab` adds an active tab at the end of the last focused window, otherwise the active tab navigates.
  // `keys_page_id` names the frame that reports the key probe, for a page that hands the focus to a frame of its own.
  async function open_page_untimed(kind, id, { new_tab, keys_page_id = id }) {
    const mark = events.length;
    const url = JSON.stringify(url_of(kind, id));
    // The page we leave reports that it is hidden a few milliseconds after the open, which would land in the next case's events.
    const leaving_page_id = new_tab ? await active_test_page_id() : undefined;
    const open_in_new_tab = `(async () => { const window_id = (await browser.windows.getLastFocused()).id; const tab = await browser.tabs.create({ windowId: window_id, url: ${url}, active: true }); return tab.id; })()`;
    const navigate_active_tab = `(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); await browser.tabs.update(tab.id, { url: ${url} }); return tab.id; })()`;
    let tab_id;
    // A page whose content script never reads the tree gets one more load, so one lost start keeps the test steady.
    for (let attempt = 0; ; attempt++) {
      tab_id = await background_call(attempt === 0 ? (new_tab ? open_in_new_tab : navigate_active_tab) : `browser.tabs.update(${tab_id}, { url: ${url} }).then((tab) => tab.id)`);
      try {
        await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 6000);
        break;
      } catch (error) {
        if (attempt >= 1) throw error;
        measurements.navigation_retries = (measurements.navigation_retries ?? 0) + 1;
      }
    }
    if (leaving_page_id) await wait_event(mark, (event) => event.type === "visibility" && event.state === "hidden" && event.page_id === leaving_page_id, `${leaving_page_id} to report that it is hidden`, 3000);
    await settle_focus({ tab_id, keys_page_id });
  }

  // The keyboard way in, for a case that tests the address bar. No case does today.
  async function open_page_by_keys(kind, id, { new_tab }) {
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

  // The same read as scroll_delta_after, with no settle after the keys: the wait for the scroll report is the wait for the effect.
  async function scroll_delta_by_press(page_id, keys) {
    const before = last_scroll_y(page_id);
    const mark = events.length;
    await press_keys(...keys);
    const reported = await wait_event(mark, scroll_of(page_id), `scroll on ${page_id} after ${keys.join(" ")}`);
    return reported.y - before;
  }

  async function scroll_delta_after(page_id, keys) {
    const before = last_scroll_y(page_id);
    const mark = events.length;
    await send_keys(...keys);
    const reported = await wait_event(mark, scroll_of(page_id), `scroll on ${page_id} after ${keys.join(" ")}`);
    return reported.y - before;
  }

  // A tab hidden and shown again within about 300 ms of its last switch sends no visibility report, so tab switches are read from the background, never from the pages.
  // `expected` is a page id or a check on the active page id. Returns the active page id.
  async function wait_active_tab(expected, what = `${expected} to be the active tab`, timeout_ms = 8000) {
    const matches = typeof expected === "function" ? expected : (page_id) => page_id === expected;
    let active_page_id;
    await poll_until(what, async () => matches((active_page_id = await active_test_page_id())), { timeout_ms });
    return active_page_id;
  }

  // Every tab activation since the first call, recorded by a listener in the background. The log lives in the background page, so a background restart starts it again.
  const SWITCH_LOG = "desertfox_key_test_tab_switches";
  async function tab_switch_mark() {
    return background_call(`(() => {
      if (!globalThis.${SWITCH_LOG}) {
        globalThis.${SWITCH_LOG} = [];
        browser.tabs.onActivated.addListener(({ tabId }) => globalThis.${SWITCH_LOG}.push(tabId));
      }
      return globalThis.${SWITCH_LOG}.length;
    })()`);
  }
  // The page ids of the tabs activated since the mark, in order. A tab that is gone or holds no test page shows as its tab id.
  async function tabs_shown_since(switch_mark) {
    const urls = await background_call(`(async () => {
      const log = globalThis.${SWITCH_LOG};
      if (!log || log.length < ${switch_mark}) return { error: "the tab switch log is gone (did the background restart?)" };
      return Promise.all(log.slice(${switch_mark}).map((tab_id) => browser.tabs.get(tab_id).then((tab) => tab.url, () => "tab " + tab_id)));
    })()`);
    return urls.map((url) => (URL.canParse(url) ? new URL(url).searchParams.get("id") ?? url : url));
  }

  // Fails when any tab came to the front since the mark, naming the pages it shows.
  async function expect_no_tab_shown(switch_mark, what) {
    const shown = await tabs_shown_since(switch_mark);
    expect(shown.length === 0, `${what}: ${shown.join(", ")}`);
  }

  // A scroll is reported SCROLL_REPORT_DELAY_MS after it ends, so the check waits that long after its barrier. The page must report F8, which holds for any page that does not cancel keys in capture, ignore mode included.
  const expect_no_scroll = (mark, page_id) => expect_absent(mark, page_id, scroll_of(page_id), `page ${page_id} scrolled`, { report_delay_ms: SCROLL_REPORT_DELAY_MS + 100 });

  // The background gives the active tab and the switches since `switch_mark` (from tab_switch_mark before the keys), so a switch that landed on the wrong tab or came twice fails by name.
  // The destination reports F8 after a settle, which proves the switch is done before the extra-switch check reads. A destination that cancels keys in capture passes `destination_cancels_keys` and the check sits out a fixed time.
  async function expect_exactly_one_visible(switch_mark, expected_page_id, { destination_cancels_keys = false } = {}) {
    if (destination_cancels_keys) {
      await sleep(1500);
    } else {
      await wait_active_tab(expected_page_id);
      await settle_focus();
      await barrier(expected_page_id);
    }
    const active_page_id = await active_test_page_id();
    expect(active_page_id === expected_page_id, `expected the active tab to be ${expected_page_id}, it is ${active_page_id ?? "no test page"}`);
    const shown = await tabs_shown_since(switch_mark);
    expect(shown.length === 1, `expected one switch to ${expected_page_id}, saw [${shown.join(", ")}]`);
  }

  // Hint labels sit in a closed shadow root, which the extension's own world reads. LAYERS.hints in src/shared/layers.ts, which the test cannot import.
  const HINTS_LAYER = 2147483647 - 4;
  const hint_label_count = async () => {
    const counts = await in_background(`(async () => { const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(`(() => { const host = [...document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}"); return host?.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint").length ?? 0; })()`)} }); })()`);
    // A failed call gives no number, so neither a "no labels" nor a "labels shown" wait passes on it.
    return typeof counts?.[0] === "number" ? counts[0] : undefined;
  };

  // The first executeScript result of the active tab, in the content script's world. A script error comes back as an object with `error`, which would pass a loose check, so it throws here.
  const in_active_tab = (code) => evaluate_in_background(rdp, EXTENSION_ID, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return (await browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))[0]; })()`).then((value) => {
    if (value?.error) throw new Error(`in the tab: ${JSON.stringify(value)}`);
    return value;
  });
  const badge_is = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;
  const is_selection_of = (page_id) => (event) => event.type === "selection" && event.page_id === page_id;
  // A key that moves the caret reports a selection change, so this is the wait after it. A caret that sticks reports nothing and the wait names the key.
  async function press_and_wait_for_move(page_id, keys, what) {
    const mark = events.length;
    await press_keys(keys);
    return wait_event(mark, is_selection_of(page_id), what);
  }
  // Presses Escape until the mode badge reads NORMAL. Each press waits for the badge to change, so a visual mode that needs two presses is not read as one.
  async function escape_to_normal(page_id) {
    for (let presses = 0; presses < 3; presses++) {
      const mark = events.length;
      await press_keys("-k", "Escape");
      const changed = await wait_event(mark, (event) => event.type === "indicator" && event.page_id === page_id, "a mode badge after Escape");
      if (changed.label === "NORMAL") return;
    }
    throw new Error("the badge never reached NORMAL after three Escape presses");
  }

  const timings_path = default_timings_path(repo_dir);
  // Called after each piece, from the signal path and at the end, so a run killed at the time cap still leaves its numbers. A failed write must not hide the run's own error.
  function write_timings({ with_summary = print_summary } = {}) {
    try {
      const timings_report = timings.report();
      timings.write_json(timings_path, timings_report, { create_dir: create_timings_dir });
      if (!with_summary) return;
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

  let firefox_info;
  try {
    if (sweep) await sweep_dead_sessions();
    session = await timings.time("driver", () => start_session({ name: session_name, session_dir: join(work_dir, "session") }));
    const firefox = session.spawn([join(key_test_dir, "launch_firefox.sh"), work_dir, profile_dir, String(debug_port), launch_mode]);
    let firefox_exit;
    firefox.on("exit", (code, signal) => { firefox_exit = signal ? `signal ${signal}` : `exit ${code}`; });
    for (let attempt = 0; ; attempt++) {
      try {
        rdp = timings.wrap_rdp(await connect_rdp(debug_port));
        break;
      } catch (error) {
        if (attempt > 60 || firefox_exit) throw new Error(`Firefox debugger never answered: ${error.message}${firefox_exit ? `, after Firefox ended (${firefox_exit})` : ""}`);
        await sleep(500);
      }
    }
    if (stall_capture) rdp.on_close(() => stall_capture.note_lost(rdp.lost_reason()));
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
    // After the setup that uses three of the internals, so the add-on is loaded and a tab exists for the window path.
    firefox_info = await check_firefox_internals(rdp, EXTENSION_ID);
    timings.set_firefox(firefox_info);
    const native_api = await evaluate_in_background(rdp, EXTENSION_ID, `typeof browser.runtime.sendNativeMessage`);
    if (native_api !== "function") throw new Error(`the background has no sendNativeMessage after the grant: ${native_api}`);
    // The background publishes its config status once it has loaded the config.
    let first_status;
    for (let attempt = 0; (first_status = await evaluate_in_background(rdp, EXTENSION_ID, `(async () => (await browser.storage.local.get("desertfox_config_status")).desertfox_config_status ?? null)()`)) == null; attempt++) {
      if (attempt >= 300) throw new Error("the background published no config status within 15 s of the nativeMessaging grant");
      await sleep(50);
    }
    if (first_status.source !== "defaults") throw new Error(`a new profile must start on the defaults, got source "${first_status.source}"`);
    // The defaults open Quick Start on a first install, and the install handler opens it after the config status is out. Wait up to 5 s for it and close it, so it cannot take focus later. A profile that opens none is fine.
    const quick_start_tab = `browser.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url.includes("/home.html"))?.id ?? null)`;
    for (let attempt = 0; attempt < 100; attempt++) {
      await sleep(50);
      const quick_start_id = await evaluate_in_background(rdp, EXTENSION_ID, quick_start_tab);
      if (quick_start_id != null) {
        await evaluate_in_background(rdp, EXTENSION_ID, `browser.tabs.remove(${quick_start_id})`);
        break;
      }
    }
  } catch (error) {
    await close({ keep_diagnostics: true });
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
  // Whether the key holds a value. The test runs in the background, so a large value (a built config) never crosses the debugger.
  const has_local = (key) => in_background(`browser.storage.local.get("${key}").then((stored) => stored["${key}"] != null)`);
  // Presses ,r and waits until the reload stores the files config. The key is removed first, so an earlier reload does not count.
  async function reload_in_place() {
    await in_background(`browser.storage.local.remove(["desertfox_files_config", "desertfox_config_status"])`);
    await send_keys(",r");
    waiting_for = ",r to store the files config and publish the config status";
    for (let attempt = 0; attempt < 200; attempt++) {
      await sleep(50);
      // The background writes the status before the files config, so only the pair shows that this reload finished.
      if ((await has_local("desertfox_files_config")) && (await has_local("desertfox_config_status"))) return;
    }
    // The host call made by hand tells a missing permission or host from a refused build.
    const probe = await in_background(`(async () => ({ granted: await browser.permissions.contains({ permissions: ["nativeMessaging"] }), host: await browser.runtime.sendNativeMessage("desertfox_host", { cmd: "read_config" }).then((reply) => ({ ok: reply.ok, error: reply.error, files: Object.keys(reply.files ?? {}).length }), (error) => String(error)) }))()`);
    throw new Error(`,r stored no files config after 10 s: ${JSON.stringify(probe)}`);
  }
  // Waits for the restart that debug.restart starts: the new background writes its tab repair report.
  async function wait_reinject_report() {
    let report;
    // Ends before the case cap, so a missing report fails with this message and not with the cap's.
    waiting_for = "the desertfox_reinject_report after debug.restart";
    for (let attempt = 0; attempt < REINJECT_REPORT_POLLS && !report; attempt++) {
      await sleep(100);
      report = await read_local("desertfox_reinject_report");
    }
    expect(report, "no desertfox_reinject_report after 20 s");
    return report;
  }

  // The pages are extension pages, so the test reads them through the background's view list.
  const extension_view = (name) => `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/${name}"))`;

  // Points the native host at a config folder and reloads it in place with ,r. The which-key shots use it to show a copy of the user config.
  // Null until the first reset loads config_dir: a new profile starts on defaults, and the files config reaches the extension only through the host.
  let linked_config_dir = null;
  const load_config_dir = async (dir) => {
    rmSync(active_config);
    symlinkSync(dir, active_config);
    // Moving away is recorded at once, so a failed reload still gets restored. Moving back counts only once the reload worked, so a lost ,r is retried by the next reset.
    if (dir !== config_dir) linked_config_dir = dir;
    await reload_in_place();
    linked_config_dir = dir;
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
  // Firefox shows a notice in a window of its own (user.js), which holds the keyboard focus until it closes.
  const clear_notices = () => in_background(`(async () => { for (const id of Object.keys(await browser.notifications.getAll())) await browser.notifications.clear(id); })()`);
  const close_tabs_with = (text) => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);

  // Polls until the check holds. `what` names the wait in the error. A probe whose timeout is the normal path and that the caller absorbs passes `expected_timeout`, so the timeout is not counted as a lost-key suspect.
  const poll_until = (what, check, options) => timings.time("waits", () => poll_until_untimed(what, check, options));
  async function poll_until_untimed(what, check, { timeout_ms = 5000, step_ms = 50, expected_timeout = false } = {}) {
    waiting_for = what;
    const deadline = Date.now() + timeout_ms;
    while (!(await check())) {
      if (Date.now() > deadline) throw expected_timeout ? new Error(`timed out waiting for ${what}`) : wait_timeout_error(what);
      await raw_sleep(step_ms);
    }
  }

  const read_config_status = () => read_local("desertfox_config_status");

  // The page itself says it holds focus, so a focus that landed in the address bar or another window is caught. document.hasFocus() is false for both.
  const page_has_focus = (tab_id) => in_background(`browser.tabs.executeScript(${tab_id}, { code: "document.hasFocus()" }).then((answers) => answers[0] === true)`);
  // What each side says about the focus, for the error of confirm_page_focus: the page, the tab and window as Firefox has them, and the window the compositor has focused.
  async function focus_state(tab_id, window_id) {
    const firefox = await in_background(`(async () => {
      const tab = await browser.tabs.get(${tab_id});
      const window = await browser.windows.get(${window_id}).catch(() => null);
      const page = await browser.tabs.executeScript(${tab_id}, { code: "[document.hasFocus(), document.visibilityState]" }).then((answers) => answers[0], (error) => String(error.message));
      return { page, tab_active: tab.active, window_focused: window?.focused ?? "window gone" };
    })()`);
    return `firefox ${JSON.stringify(firefox)}, compositor focus ${await session.focused_window()}, clients ${await session.window_list()}`;
  }
  // Focus lands in browser chrome after tabs close, and a closed window leaves compositor focus on a Firefox window that is not the page's (measured), which no extension call can restore on Wayland. Each round starts with a hyprctl focus of the page's window by title, then asks for the window and tab, then uses the focus_page chord, until the page reports focus.
  async function confirm_page_focus(tab_id, window_id) {
    const focused = (timeout_ms) => poll_until("page focus", () => page_has_focus(tab_id), { timeout_ms, expected_timeout: true }).then(() => true, () => false);
    if (await focused(300)) return;
    const rounds = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const title = await in_background(`browser.tabs.get(${tab_id}).then((tab) => tab.title)`);
      // A failed hyprctl call must not end the round: the extension calls and the chord below worked before it.
      const hyprctl_error = await session.focus_firefox_window(typeof title === "string" ? title : "").then(() => "", (error) => ` (hyprctl focus failed: ${error.message.split("\n")[0]})`);
      await in_background(`(async () => { await browser.windows.update(${window_id}, { focused: true }); await browser.tabs.update(${tab_id}, { active: true }); })()`);
      if (await focused(1500)) return;
      await send_keys(...ALT(","));
      if (await focused(1500)) return;
      rounds.push(`round ${attempt + 1}: ${await focus_state(tab_id, window_id)}${hyprctl_error}`);
    }
    throw new Error(`tab ${tab_id} never reported focus (${rounds.join("; ")})`);
  }

  // Keys and visibility reports of a page are unreliable until NEW_PAGE_QUIET_MS after the browser activated its tab.
  async function wait_tab_quiet(tab_id) {
    const activated_at = await background_call(`browser.tabs.get(${tab_id}).then((tab) => tab.lastAccessed)`);
    const too_young_ms = NEW_PAGE_QUIET_MS - (Date.now() - activated_at);
    if (too_young_ms > 0) await sleep(too_young_ms);
  }

  // The focus-only settle: waits for the page of a tab to report focus, then for the key probe, after keys that switch tab, close one or leave the line. Defaults to the active tab.
  // It reads the page, so it serves the test pages only. An extension page cannot answer it.
  async function settle_focus({ tab_id, keys_page_id, timeout_ms = 3000 } = {}) {
    const tab = await background_call(`(async () => {
      const tab = ${tab_id === undefined ? "(await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]" : `await browser.tabs.get(${tab_id})`};
      return { id: tab.id, window_id: tab.windowId, url: tab.url };
    })()`);
    try {
      await poll_until(`tab ${tab.id} to report page focus`, () => page_has_focus(tab.id), { timeout_ms, expected_timeout: true });
    } catch {
      await confirm_page_focus(tab.id, tab.window_id);
    }
    await wait_takes_keys(keys_page_id ?? new URL(tab.url).searchParams.get("id"));
  }

  // A page drops every key of its first moments (7a probe: F8 lost at 0 and 30 ms after tree_read, kept at 100 ms), and a key pressed right after it reports focus.
  // So the page is ready when it reports a key: PROBE_KEY, which nothing binds, pressed again until the page sees one. A key seen on another page, such as the top page of a frame that has no focus yet, counts as not seen.
  // A late probe report matches no barrier, which waits for BARRIER_KEY. A case that counts the page's keydown reports skips PROBE_KEY, because a probe press can land after the case's mark.
  const wait_takes_keys = (page_id) => timings.time("waits", () => wait_takes_keys_untimed(page_id));
  async function wait_takes_keys_untimed(page_id) {
    const deadline = Date.now() + KEY_PROBE_TIMEOUT_MS;
    for (let presses = 1; ; presses++) {
      waiting_for = `${page_id} to take the probe key ${PROBE_KEY}`;
      const mark = events.length;
      await press_keys("-k", PROBE_KEY);
      if (await server.wait_for_event(mark, (event) => event.type === "keydown" && event.key === PROBE_KEY && event.page_id === page_id, KEY_PROBE_TRY_MS)) return;
      if (Date.now() > deadline) throw wait_timeout_error(`${page_id} to take the probe key ${PROBE_KEY} (${presses} presses)`);
      measurements.key_probe_retries = (measurements.key_probe_retries ?? 0) + 1;
    }
  }

  // A bulk tabs.remove of 30 or more tabs outlasts one debugger call, so the close is started and then polled.
  async function wait_for_tabs(what, count_expr, expected) {
    await poll_until(what, async () => (await in_background(count_expr)) === expected, { timeout_ms: 30000 });
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

  // Focuses a test page, so a step that types keys has a page to type into. It prefers the active tab of the last focused window and never takes an about: or extension page, which cannot answer the focus check.
  // With no test page left it opens one.
  async function refocus_any_tab() {
    let target = await background_call(`(async () => {
      const test_pages = { url: "*://127.0.0.1/*" };
      const tab = (await browser.tabs.query({ ...test_pages, active: true, lastFocusedWindow: true }))[0] ?? (await browser.tabs.query(test_pages))[0];
      return tab ? { id: tab.id, window_id: tab.windowId, url: tab.url } : null;
    })()`);
    if (!target) {
      const mark = events.length;
      target = await background_call(`browser.tabs.create({ url: ${JSON.stringify(url_of("page", "home_cleanup"))}, active: true }).then((tab) => ({ id: tab.id, window_id: tab.windowId, url: tab.url }))`);
      await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "home_cleanup", "content script ready on home_cleanup", 10000);
    }
    await confirm_page_focus(target.id, target.window_id);
    return new URL(target.url).searchParams.get("id");
  }

  const temp_settings_pending = async () => (await read_config_status())?.temp?.length > 0;

  // Unsets the temp edits through the command line, which rebuilds the effective config the way a user's :unset does. Returns whether it typed keys.
  async function clear_temp_settings() {
    if (!(await temp_settings_pending())) return false;
    await run_line(":unset -t all");
    await poll_until("the temp settings to clear", async () => !(await temp_settings_pending()), { timeout_ms: 6000 });
    return true;
  }

  const config_restore_pending = () => linked_config_dir !== config_dir;

  // Puts the config link on config_dir and reloads it in place. The first reset calls it for the initial load. A debug.restart may still be starting the new background, and a ,r sent to it is lost, so the status key comes first.
  // Returns whether it typed keys.
  async function restore_config() {
    if (!config_restore_pending()) return false;
    await poll_until("the background to publish its config status", async () => (await read_config_status()) != null, { timeout_ms: 15000 });
    await load_config_dir(config_dir);
    await poll_until("the files config to apply", async () => (await read_config_status())?.source === "files", { timeout_ms: 10000 });
    return true;
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
    // The count settles before Firefox picks the new active tab, and a late close of the old active tab can move it.
    await wait_for_tabs("the home tab to be the active tab", `browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab?.id)`, home.tab_id);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === home_id, `content script ready on ${home_id}`, 10000);
    await confirm_page_focus(home.tab_id, home.window_id);
    // A page drops the keys of its first moments, and restore_config types ,r, so a pending load waits for the key probe first.
    if (config_restore_pending()) await wait_takes_keys(home_id);
    const restored = await restore_config();
    const unset = await clear_temp_settings();
    // Their keys can leave the focus elsewhere, so the page is asked once more only when they typed.
    if (restored || unset) await confirm_page_focus(home.tab_id, home.window_id);
    await wait_takes_keys(home_id);
    return { tab_ids: [home.tab_id], window_ids: [home.window_id] };
  }

  // Runs after the cases, pass or fail. The teardown callbacks each report their own failure. Close, focus, config restore and temp unset each run in their own try, so a failed close does not skip the config restore.
  async function clean_up_piece(file, state, snapshot) {
    const failed_step = (step, error) => {
      // After a signal the steps fail on the closed debugger, as the cases do in run_case.
      if (teardown_started) return;
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
    // Only these two steps type keys, so a piece that left no config or temp edits skips the refocus.
    const restore_pending = config_restore_pending();
    const unset_pending = await temp_settings_pending();
    // The page must take keys before ,r and :unset, as in the reset. A lost ,r after this probe is a real fault of the page, not a young page.
    if (restore_pending || unset_pending) await attempt("cleanup focus", async () => wait_takes_keys(await refocus_any_tab()));
    if (restore_pending) await attempt("cleanup config restore", restore_config);
    if (unset_pending) await attempt("cleanup temp unset", clear_temp_settings);
  }

  // The command line is an extension iframe in the page. This reads its text, rows and note from the frame of the selected tab, or answers { open: false } when none is there.
  // The function runs in the frame's content process, so it holds no outer variable.
  const read_cmdline_frame = (frame_window) => {
    const document = frame_window.document;
    const line = document.getElementById("line");
    if (!line) return { open: false, building: true };
    const text = (element) => element?.textContent ?? "";
    const items = [...document.querySelectorAll(".desertfox-cmdline-item")];
    const note = document.getElementById("note");
    return {
      open: true,
      // The page has taken its start message when the list shows or the line holds text. Before that it drops an Escape.
      ready: !document.getElementById("list").hidden || line.value !== "",
      value: line.value,
      caret: line.selectionStart,
      focused: document.hasFocus(),
      prompt: text(document.querySelector(".desertfox-cmdline-prompt")),
      list_open: !document.getElementById("list").hidden,
      rows: items.length,
      row_texts: items.map((item) => item.textContent),
      row_flags: items.map((item) => [...item.querySelectorAll("[class*='desertfox-cmdline-flag-']")].map((flag) => flag.className.match(/desertfox-cmdline-flag-(\w+)/)[1])),
      selected: items.find((item) => item.classList.contains("desertfox-cmdline-selected"))?.getAttribute("data-index") ?? null,
      marked: items.filter((item) => item.classList.contains("desertfox-cmdline-item-marked")).length,
      note: note.hidden ? "" : text(note),
    };
  };
  async function read_cmdline_state() {
    const frames = await evaluate_in_page_frames(rdp, "cmdline.html", read_cmdline_frame.toString()).catch((error) => { throw with_firefox_version(error, firefox_info); });
    return frames[0] ?? { open: false };
  }
  // Escape closes the list first and the line next, so this presses until the line is gone, and waits after each press for the state to change.
  async function close_cmdline() {
    for (let presses = 0; presses < 5; presses++) {
      // A line caught before its page is ready can drop an Escape, so it gets a moment to become ready first. A line that stays unready is pressed anyway.
      const before = await wait_cmdline((line) => !line.open || line.ready, "the command line to be ready or closed", UNREADY_LINE_WAIT_MS, { expected_timeout: true }).catch(() => read_cmdline_state());
      if (!before.open) return;
      await press_keys("-k", "Escape");
      await wait_cmdline((after) => !after.open || after.list_open !== before.list_open || after.marked !== before.marked || after.value !== before.value, "Escape to change the command line");
    }
    throw new Error("the command line stayed open after five Escape presses");
  }
  // Polls the command line state until the check holds, and puts the last state in the timeout error.
  async function wait_cmdline(check, what, timeout_ms = 3000, { expected_timeout = false } = {}) {
    let state;
    try {
      await poll_until(what, async () => check((state = await read_cmdline_state())), { timeout_ms, expected_timeout });
    } catch (error) {
      throw new Error(`${error.message} (command line: ${JSON.stringify(state)})`);
    }
    return state;
  }

  const line_takes_keys = (line) => line.open && line.focused;
  // Keys typed while the focus moves into the line's frame can be lost, so this waits until the line holds the focus. It presses ":" only when no line is open.
  async function open_cmdline() {
    if (!(await read_cmdline_state()).open) await press_keys(":");
    return wait_cmdline(line_takes_keys, "the command line to open and take the focus");
  }
  // Types text at the caret of the open line and waits until the line holds it, so the key pressed next acts on that text and not on a part of it.
  // `until` adds a check on the same state, such as the rows the list must show first: the list of tabs or bookmarks fills in after the text.
  async function type_in_line(text, { until = () => true, what } = {}) {
    const before = await wait_cmdline(line_takes_keys, "the command line to take keys");
    const expected = before.value.slice(0, before.caret) + text + before.value.slice(before.caret);
    await press_keys(text);
    return wait_cmdline((line) => line.value === expected && until(line), what ?? `the command line to hold "${expected}"`);
  }
  // Presses Tab and waits for its effect: a row previewed in the line, or the one match taken into it.
  async function complete_in_line() {
    const before = await wait_cmdline(line_takes_keys, "the command line to take keys");
    await press_keys("-k", "Tab");
    return wait_cmdline((line) => line.selected !== before.selected || line.value !== before.value, "Tab to complete in the command line");
  }
  // The address bar way of type_in_line, for the pages only the address bar opens. Firefox draws the bar, so chrome code reads its value.
  async function type_in_address_bar(text) {
    await press_keys(text);
    await poll_until(`the address bar to hold "${text}"`, async () => (await evaluate_in_chrome(rdp, `Services.wm.getMostRecentWindow("navigator:browser").gURLBar.value`)) === text);
  }
  // Opens the line, types the command and presses Enter once the line holds it. A leading ":" is the key that opens the line.
  async function run_line(text, options) {
    await open_cmdline();
    await type_in_line(text.replace(/^:/, ""), options);
    await press_keys("-k", "Return");
  }

  // Presses a key with no binding after the key under test and waits for the page to see it, so every earlier key has reached the page by then.
  // It returns the barrier event's index in `events`. It fails by name when the key never shows, or shows on another page, such as after a tab switch that was not meant.
  // A mode that swallows keys never reports it. Then the barrier times out and does not pass.
  async function barrier(page_id, { key = BARRIER_KEY, timeout_ms = 3000 } = {}) {
    // The key would type into the line and never reach the page.
    if ((await read_cmdline_state()).open) throw new Error(`barrier key ${key} refused: the command line is open`);
    const mark = events.length;
    await press_keys("-k", key);
    const seen = await wait_event(mark, (event) => event.type === "keydown" && event.key === key, `barrier key ${key} on ${page_id}`, timeout_ms);
    if (seen.page_id !== page_id) throw new Error(`barrier key ${key} reached ${seen.page_id}, not ${page_id}`);
    return events.indexOf(seen);
  }

  // Fails when an event that matches `predicate` came between `mark` and the barrier. A key that never arrived also leaves nothing, so the caller needs a proof that it arrived (a command line value, a mode label).
  // `report_delay_ms` waits after the barrier for a report that trails its cause, such as a scroll (SCROLL_REPORT_DELAY_MS plus a margin).
  async function expect_absent(mark, page_id, predicate, what, { report_delay_ms = 0 } = {}) {
    const barrier_index = await barrier(page_id);
    if (report_delay_ms > 0) await sleep(report_delay_ms);
    const found = events.slice(mark, report_delay_ms > 0 ? undefined : barrier_index).find(predicate);
    expect(!found, `${what}: ${JSON.stringify(found)}`);
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
          await within_case_cap(name, body);
          console.log(`SETUP ${name}`);
        } catch (error) {
          state.setup_failure = { name, reason: error.message };
          console.log(`SETUP FAIL ${name}: ${error.message}`);
        }
      });
    }
    // Callbacks run in reverse order when the piece ends, pass or fail.
    const on_teardown = (callback) => state.teardowns.push(callback);
    // Stores a number for the end-of-run measurements line.
    const record = (key, value) => { measurements[key] = value; };
    // The cases of a piece file in test/key/p<number>_*.mjs get these helpers.
    const context = { config_dir, config_copy, load_config_dir, take_shot: (path) => timings.time("driver", () => session.shot(path)), run_case: run_piece_case, setup, on_teardown, expect, open_page, open_page_by_keys, send_keys, press_keys, settle_focus, wait_takes_keys, poll_until, wait_tab_quiet, barrier, expect_absent, read_cmdline_state, wait_cmdline, close_cmdline, open_cmdline, type_in_line, complete_in_line, run_line, type_in_address_bar, scroll_report_wait_ms: SCROLL_REPORT_DELAY_MS + 100, which_key_delay_ms: WHICH_KEY_DELAY_MS, sleep, events, wait_event, since, find_event, url_of, rdp, extension_id: EXTENSION_ID, scroll_delta_after, scroll_delta_by_press, wait_active_tab, tab_switch_mark, tabs_shown_since, expect_no_tab_shown, scroll_of, last_scroll_y,
      // Moved out of the run.mjs cases. Pieces may use them too.
      in_background, clear_notices, read_local, reload_in_place, wait_reinject_report, injections_of, settled_injection_count, expect_no_scroll, expect_exactly_one_visible, hint_label_count, in_active_tab, badge_is, is_selection_of, press_and_wait_for_move, escape_to_normal, extension_view, close_tabs_with, record };
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
    write_timings({ with_summary: false });
  }

  async function close({ keep_diagnostics = results.some((result) => !result.pass) } = {}) {
    await teardown({ keep_diagnostics });
    closed = true;
    console.log(JSON.stringify(measurements));
    write_timings();
  }

  // The reason the debugger connection closed, or undefined while Firefox answers. A worker stops taking pieces once its browser is gone.
  const firefox_lost = () => rdp?.lost_reason();

  return { context_for, run_piece, results, measurements, sample_tabs, firefox_lost, close };
}
