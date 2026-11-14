// Hands-on comparison: one visible Firefox window per tool (DesertFox from this checkout and the rig's pinned rivals), each in a fresh profile.
// Usage: node compare.mjs open <url>... | add <url> | close
// Windows open where the desktop puts them. The add-ons are temporary installs, so a window restart drops its add-on: close and open again instead.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect_rdp, evaluate_in_chrome, install_temporary_addon } from "../../../test/key/rdp.mjs";
import { read_start_ticks } from "../../owner_test/process_guard.ts";
import { DESERTFOX_ID, PINNED_BUILDS, xpi_path } from "./tools.mjs";

const repo_dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const COMPARE_TOOLS = ["desertfox", "vimium", "vimiumc", "tridactyl"];
const LABELS = { desertfox: "DesertFox", vimium: "Vimium", vimiumc: "Vimium C", tridactyl: "Tridactyl" };

export const compare_dir = (env = process.env) => join(env.XDG_CACHE_HOME || join(env.HOME, ".cache"), "desertfox-compare");
export const state_file_of = (dir) => join(dir, "state.json");
export const profile_dir_of = (dir, tool) => join(dir, tool, "profile");

// The state file lists every window this tool started. Written atomically, before and after each start, so a crash leaves a trail that close can follow.
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

// A window is ours to stop only while its recorded pid still has the start ticks recorded with it, so a recycled pid is never signalled. A zero pid is a window that never started.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const free_port = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

function firefox_pid_for(profile) {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const words = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      if (words.includes("-start-debugger-server") && words.includes(profile)) return Number(entry);
    } catch { /* the process ended */ }
  }
  return null;
}

// The pinned xpi is fetched once into the compare folder and checked against the rig's sha256 pin every time it is used.
async function addon_for(dir, tool) {
  if (tool === "desertfox") return { path: join(repo_dir, "dist"), id: DESERTFOX_ID };
  const pin = PINNED_BUILDS[tool];
  const path = xpi_path(dir, tool);
  if (!existsSync(path)) {
    const response = await fetch(pin.url);
    if (!response.ok) throw new Error(`${tool}: download failed with status ${response.status}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (sha256 !== pin.sha256) {
    rmSync(path, { force: true });
    throw new Error(`${tool}: sha256 ${sha256} does not match the pin ${pin.sha256}`);
  }
  return { path, id: pin.gecko_id };
}

const name_page = (tool) => `data:text/html,${encodeURIComponent(`<title>${LABELS[tool].toUpperCase()} WINDOW</title><h1>${LABELS[tool]}</h1>`)}`;

async function open_windows(dir, urls) {
  if (read_state(dir).length > 0) throw new Error("compare windows are already recorded. Run just compare-close first.");
  const addons = {};
  for (const tool of COMPARE_TOOLS) addons[tool] = await addon_for(dir, tool);
  const windows = [];
  try {
    for (const tool of COMPARE_TOOLS) {
      const profile = profile_dir_of(dir, tool);
      rmSync(profile, { recursive: true, force: true });
      mkdirSync(profile, { recursive: true });
      writeFileSync(join(profile, "user.js"), readFileSync(join(repo_dir, "test/key/user.js"), "utf8"));
      const port = await free_port();
      const record = { tool, pid: 0, start_ticks: 0, port, profile };
      windows.push(record);
      write_state(dir, windows);
      const child = spawn("firefox", ["-no-remote", "-profile", profile, "-start-debugger-server", String(port), name_page(tool), ...urls], { detached: true, stdio: "ignore" });
      child.once("error", () => {});
      child.unref();
      let rdp;
      for (let i = 0; i < 160 && !rdp; i++) { try { rdp = await connect_rdp(port); } catch { await sleep(250); } }
      if (!rdp) throw new Error(`${tool}: no debugger connection`);
      record.pid = firefox_pid_for(profile) ?? 0;
      record.start_ticks = read_start_ticks(record.pid) ?? 0;
      write_state(dir, windows);
      if (record.start_ticks === 0) throw new Error(`${tool}: cannot find the window's process`);
      await install_temporary_addon(rdp, addons[tool].path);
      console.log(`${LABELS[tool]} ready on port ${port}`);
    }
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
  for (const w of running) {
    const rdp = await connect_rdp(w.port);
    console.log(`${LABELS[w.tool]}: ${await evaluate_in_chrome(rdp, open_tab_in_chrome(url))}`);
  }
}

async function stop(w) {
  const same = () => read_start_ticks(w.pid) === w.start_ticks;
  for (const [signal, wait_ms] of [["SIGTERM", 8000], ["SIGKILL", 3000]]) {
    try { process.kill(w.pid, signal); } catch { /* already gone */ }
    for (let waited = 0; waited < wait_ms && same(); waited += 100) await sleep(100);
    if (!same()) return true;
  }
  return false;
}

export async function close_windows(dir) {
  const windows = read_state(dir);
  const { running, gone } = pick_close_targets(windows, read_start_ticks);
  const kept = [];
  for (const w of running) {
    if (await stop(w)) console.log(`${LABELS[w.tool]}: closed`);
    else { console.log(`${LABELS[w.tool]}: still running after SIGKILL, kept in the state file`); kept.push(w); }
  }
  for (const w of gone) console.log(`${LABELS[w.tool]}: already gone`);
  for (const w of windows) {
    if (kept.includes(w)) continue;
    if (owns_profile(dir, w)) rmSync(dirname(w.profile), { recursive: true, force: true });
    else console.log(`${LABELS[w.tool]}: profile ${w.profile} is not ours, left alone`);
  }
  if (kept.length > 0) write_state(dir, kept);
  else rmSync(state_file_of(dir), { force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2);
  const dir = compare_dir();
  if (action === "open") await open_windows(dir, args);
  else if (action === "add" && args.length === 1) await add_url(dir, args[0]);
  else if (action === "close") await close_windows(dir);
  else { console.error("usage: compare.mjs open <url>... | add <url> | close"); process.exit(2); }
  process.exit(0);
}
