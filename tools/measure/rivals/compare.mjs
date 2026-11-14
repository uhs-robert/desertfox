// Hands-on comparison: one visible Firefox window per tool (DesertFox from this checkout and the rig's pinned rivals), each in a fresh profile.
// Usage: node compare.mjs open <url>... | add <url> | close
// The windows run as systemd units and open where the desktop puts them. The add-ons are temporary installs, so a window restart drops its add-on: close and open again instead.
// The launch, lock, profile seed and stop come from tools/owner_test, shared with the owner-test windows.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect_rdp, evaluate_in_chrome, install_temporary_addon } from "../../../test/key/rdp.mjs";
import { stop_process } from "../../owner_test/close.ts";
import { flock_argv, LOCK_BUSY_EXIT, LOCK_HELD_ENV } from "../../owner_test/lock.ts";
import { read_start_ticks } from "../../owner_test/process_guard.ts";
import { seed_user_js } from "../../owner_test/profile.ts";
import { check_environment, firefox_pid_for, real_close_deps, sleep, start_unit } from "../../owner_test/system.ts";
import { remove_policy_addon } from "./policy_addon.mjs";
import { DESERTFOX_ID, fetch_pinned_xpi, PINNED_BUILDS, xpi_path } from "./tools.mjs";

const repo_dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const COMPARE_TOOLS = ["desertfox", "vimium", "vimiumc", "tridactyl"];
const LABELS = { desertfox: "DesertFox", vimium: "Vimium", vimiumc: "Vimium C", tridactyl: "Tridactyl" };

export const compare_dir = (env = process.env) => join(env.XDG_CACHE_HOME || join(env.HOME, ".cache"), "desertfox-compare");
export const state_file_of = (dir) => join(dir, "state.json");
export const profile_dir_of = (dir, tool) => join(dir, tool, "profile");
export const unit_of = (tool) => `desertfox-compare-${tool}`;

// The state file lists every window this tool started. Written atomically, before and after each start, so a crash leaves a trail that close follows.
export function write_state(dir, windows) {
  mkdirSync(dir, { recursive: true });
  const file = state_file_of(dir);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ windows }, null, 2), { mode: 0o600 });
  renameSync(temp, file);
}

const is_window = (w) => w && typeof w.tool === "string" && COMPARE_TOOLS.includes(w.tool)
  && Number.isInteger(w.pid) && Number.isInteger(w.start_ticks) && Number.isInteger(w.port) && typeof w.profile === "string";

// A missing file is an empty list. A damaged file throws, so close never guesses what to stop.
export function read_state(dir) {
  const file = state_file_of(dir);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed?.windows) || !parsed.windows.every(is_window)) throw new Error(`${file} is not a compare state file. Remove it by hand.`);
  return parsed.windows;
}

// A window is ours to stop only while its recorded pid still has the start ticks recorded with it, so a recycled pid is never signalled.
export function pick_close_targets(windows, ticks_of_pid) {
  const running = [];
  const gone = [];
  for (const w of windows) {
    const same = w.pid > 1 && w.start_ticks > 0 && ticks_of_pid(w.pid) === w.start_ticks;
    (same ? running : gone).push(w);
  }
  return { running, gone };
}

// A profile is deleted only at the exact path this tool makes for its tool name.
export const owns_profile = (dir, w) => w.profile === profile_dir_of(dir, w.tool);

// Stops one window and says whether nothing of it runs any more. The unit name is ours by construction. A record with no pid (a start that stopped before the pid was known) is found by its profile path, which lives only under the compare folder.
export async function close_window(dir, w, deps) {
  const lines = [];
  const unit_gone = deps.stop_unit(unit_of(w.tool));
  let { pid, start_ticks } = w;
  if ((pid <= 1 || start_ticks <= 0) && owns_profile(dir, w)) {
    pid = deps.find_pid(w.profile) ?? 0;
    start_ticks = pid > 1 ? (deps.read_start_ticks(pid) ?? 0) : 0;
  }
  const process_gone = await stop_process(LABELS[w.tool], pid, start_ticks, deps, lines);
  return { lines, gone: unit_gone && process_gone };
}

export async function close_windows(dir, deps = { ...real_close_deps(), find_pid: firefox_pid_for }) {
  const windows = read_state(dir);
  const kept = [];
  for (const w of windows) {
    const result = await close_window(dir, w, deps);
    for (const line of result.lines) console.log(line);
    if (!result.gone) { console.log(`${LABELS[w.tool]}: still running, kept in the state file`); kept.push(w); continue; }
    if (owns_profile(dir, w)) rmSync(dirname(w.profile), { recursive: true, force: true });
    else console.log(`${LABELS[w.tool]}: profile ${w.profile} is not ours, left alone`);
  }
  if (kept.length > 0) write_state(dir, kept);
  else rmSync(state_file_of(dir), { force: true });
  return kept.length === 0;
}

const free_port = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

// The pinned xpi is fetched once into the compare folder and checked against the rig's sha256 pin every time it is used.
async function addon_for(dir, tool) {
  if (tool === "desertfox") return { path: join(repo_dir, "dist"), id: DESERTFOX_ID, version: JSON.parse(readFileSync(join(repo_dir, "dist", "manifest.json"), "utf8")).version };
  const pin = PINNED_BUILDS[tool];
  const path = xpi_path(dir, tool);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    await fetch_pinned_xpi(tool, path);
  }
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (sha256 !== pin.sha256) {
    rmSync(path, { force: true });
    throw new Error(`${tool}: sha256 ${sha256} does not match the pin ${pin.sha256}`);
  }
  return { path, id: pin.gecko_id, version: pin.version };
}

const name_page = (tool) => `data:text/html,${encodeURIComponent(`<title>${LABELS[tool].toUpperCase()} WINDOW</title><h1>${LABELS[tool]}</h1>`)}`;

// The extensions that are active in the window, other than themes and Firefox's own.
const active_extensions = (rdp) => evaluate_in_chrome(rdp, `{ const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"); const all = await AddonManager.getAllAddons(); return JSON.stringify(all.filter((a) => a.type === "extension" && !a.isSystem && !a.hidden && a.isActive).map((a) => ({ id: a.id, version: a.version, temporary: a.temporarilyInstalled }))); }`).then(JSON.parse);

// The window must run exactly its own tool: the policy-installed DesertFox is a second key handler, and for the DesertFox window it can be the build that loaded.
export function judge_window(tool, addon, active) {
  const wrong = active.filter((a) => a.id !== addon.id).map((a) => a.id);
  if (wrong.length > 0) return `${tool}: another add-on is active: ${wrong.join(", ")}`;
  const own = active.find((a) => a.id === addon.id);
  if (!own) return `${tool}: its add-on is not active`;
  if (own.version !== addon.version) return `${tool}: version ${own.version} runs, expected ${addon.version}`;
  if (tool === "desertfox" && !own.temporary) return "desertfox: the loaded build is not the temporary install of this checkout";
  return null;
}

async function start_window(dir, tool, urls, windows, addon) {
  const profile = profile_dir_of(dir, tool);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  writeFileSync(join(profile, "user.js"), seed_user_js(readFileSync(join(repo_dir, "test/key/user.js"), "utf8")));
  const port = await free_port();
  const record = { tool, pid: 0, start_ticks: 0, port, profile };
  windows.push(record);
  write_state(dir, windows);
  const started = start_unit({
    unit: unit_of(tool), command: "firefox", cwd: dir, log_file: join(dir, tool, "firefox.log"), who: "compare",
    args: ["-no-remote", "-profile", profile, "-start-debugger-server", String(port), name_page(tool), ...urls],
  });
  record.pid = started.pid;
  record.start_ticks = read_start_ticks(started.pid) ?? 0;
  write_state(dir, windows);
  let rdp;
  for (let i = 0; i < 160 && !rdp; i++) { try { rdp = await connect_rdp(port); } catch { await sleep(250); } }
  if (!rdp) throw new Error(`${tool}: no debugger connection`);
  // The unit may run a wrapper first, so the pid is read again from the profile.
  record.pid = firefox_pid_for(profile) ?? record.pid;
  record.start_ticks = read_start_ticks(record.pid) ?? 0;
  write_state(dir, windows);
  const run_in_chrome = (block) => evaluate_in_chrome(rdp, block);
  await remove_policy_addon(run_in_chrome);
  await install_temporary_addon(rdp, addon.path);
  const problem = judge_window(tool, addon, await active_extensions(rdp));
  if (problem) throw new Error(problem);
  console.log(`${LABELS[tool]} ready on port ${port}`);
}

async function open_windows(dir, urls) {
  check_environment("compare");
  if (read_state(dir).length > 0) throw new Error("compare windows are already recorded. Run just compare-close first.");
  const addons = {};
  for (const tool of COMPARE_TOOLS) addons[tool] = await addon_for(dir, tool);
  const windows = [];
  try {
    for (const tool of COMPARE_TOOLS) await start_window(dir, tool, urls, windows, addons[tool]);
  } catch (error) {
    console.error(`compare: ${error.message}. Closing what opened.`);
    await close_windows(dir);
    throw error;
  }
}

const open_tab_in_chrome = (url) => `{ const w = Services.wm.getMostRecentWindow("navigator:browser"); const t = w.gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); w.gBrowser.selectedTab = t; return w.gBrowser.tabs.length + " tabs"; }`;

async function add_url(dir, url) {
  const windows = read_state(dir);
  if (windows.length === 0) throw new Error("no compare windows are open. Run just compare first.");
  const { running } = pick_close_targets(windows, read_start_ticks);
  let failed = 0;
  for (const w of running) {
    try {
      console.log(`${LABELS[w.tool]}: ${await evaluate_in_chrome(await connect_rdp(w.port), open_tab_in_chrome(url))}`);
    } catch (error) {
      failed++;
      console.log(`${LABELS[w.tool]}: no tab added: ${error.message}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

// open and close run one at a time: the script runs itself again under flock(1), which the kernel releases when that run ends.
function rerun_under_lock(dir) {
  const run = spawnSync("flock", flock_argv(join(dir, "lock"), [process.execPath, ...process.execArgv, ...process.argv.slice(1)]), { stdio: "inherit", env: { ...process.env, [LOCK_HELD_ENV]: "1" } });
  if (run.status === LOCK_BUSY_EXIT) throw new Error("another compare call is still running");
  if (run.error) throw new Error(`could not run flock: ${run.error.message}`);
  process.exit(run.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2);
  const dir = compare_dir();
  try {
    if ((action === "open" || action === "close") && process.env[LOCK_HELD_ENV] !== "1") rerun_under_lock(dir);
    if (action === "open") await open_windows(dir, args);
    else if (action === "add" && args.length === 1) await add_url(dir, args[0]);
    else if (action === "close") process.exitCode = (await close_windows(dir)) ? 0 : 1;
    else { console.error("usage: compare.mjs open <url>... | add <url> | close"); process.exitCode = 2; }
  } catch (error) {
    console.error(`compare: ${error.message}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
