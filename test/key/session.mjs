// The nested, invisible session a key-test shard runs in: a private session bus, headless labwc as the host and
// Hyprland nested in it, plus one keyboard client (keyboard.py) for the whole session.
// Each session lives in its own runtime dir, /tmp/dfk-<uid>-<name>, which holds its bus, its Wayland sockets and an
// owner file with the pid of the process that started it. Every process of the session carries that dir in its
// environment, which is how stop() and the sweep find them, children and strays included.
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run_execfile = promisify(execFile);
const key_test_dir = dirname(fileURLToPath(import.meta.url));
const RUNTIME_PREFIX = `dfk-${process.getuid()}-`;
// Hyprland's event socket <runtime>/hypr/<62-char signature>/.socket2.sock must fit sun_path (107 bytes).
const MAX_NAME_LENGTH = 107 - `/tmp/${RUNTIME_PREFIX}`.length - "/hypr/".length - 62 - "/.socket2.sock".length;
const OWNER_FILE = "owner";
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
const OUTPUT = "WAYLAND-1";
const STOP_WAIT_MS = 2000;
const KEY_REPLY_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms));
export const runtime_dir_of = (name) => join("/tmp", `${RUNTIME_PREFIX}${name}`);

async function wait_until(what, check, { timeout_ms, step_ms = 50 }) {
  const deadline = Date.now() + timeout_ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout_ms} ms waiting for ${what}`);
    await sleep(step_ms);
  }
}

function process_is_alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Anchored on "=<runtime>" plus "/" or the end, so session "ok1" never matches "ok12".
function pids_carrying(runtime_dir) {
  const pids = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    let environ;
    try {
      environ = readFileSync(`/proc/${entry}/environ`, "latin1");
    } catch {
      continue;
    }
    if (environ.split("\0").some((pair) => { const value = pair.slice(pair.indexOf("=") + 1); return pair.includes("=") && (value === runtime_dir || value.startsWith(`${runtime_dir}/`)); })) pids.push(Number(entry));
  }
  return pids;
}

function process_group_of(pid) {
  try {
    // Field 5 of /proc/<pid>/stat, after the command name in parentheses, which can itself hold spaces.
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
  } catch {
    return undefined;
  }
}

function signal_all(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Gone already.
    }
  }
}

async function terminate(pids_now, wait_ms) {
  signal_all(pids_now(), "SIGTERM");
  await wait_until("processes to exit", () => pids_now().length === 0, { timeout_ms: wait_ms }).catch(() => undefined);
  signal_all(pids_now(), "SIGKILL");
}

// The clients go first, so Firefox and the keyboard never see their compositor vanish under them. Then the rest of
// the session, bus and compositors and any stray that carries the dir. A process left after SIGKILL is an error.
async function stop_runtime(runtime_dir, client_groups = new Set()) {
  const is_client = (pid) => client_groups.has(process_group_of(pid));
  if (client_groups.size > 0) await terminate(() => pids_carrying(runtime_dir).filter(is_client), STOP_WAIT_MS);
  await terminate(() => pids_carrying(runtime_dir), STOP_WAIT_MS);
  await wait_until("killed processes to go", () => pids_carrying(runtime_dir).length === 0, { timeout_ms: 1000 }).catch(() => undefined);
  const left = pids_carrying(runtime_dir);
  rmSync(runtime_dir, { recursive: true, force: true });
  if (left.length > 0) throw new Error(`processes still carry ${runtime_dir} after SIGKILL: ${left.join(", ")}`);
}

function read_owner_pid(runtime_dir) {
  try {
    const text = readFileSync(join(runtime_dir, OWNER_FILE), "utf8").trim();
    return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : undefined;
  } catch {
    return undefined;
  }
}

// Stops the session of a worker that died without its own teardown. The caller knows the owner is gone.
export const stop_session_named = (name) => stop_runtime(runtime_dir_of(name));

const sleep_sync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// SIGKILLs every process of a session and removes its runtime dir without yielding. For a worker whose coordinator died while
// its session was still starting: the start code waits at an await, and stop_session_named would let it go on and spawn the next process.
export function kill_session_now(name) {
  const runtime_dir = runtime_dir_of(name);
  // A process stuck in an uninterruptible wait outlives SIGKILL. Its dir and owner file stay, so a later sweep stops it.
  // A failed /proc scan counts the same way, and never throws, since the caller exits right after.
  try {
    for (let pass = 0; pass < 50; pass++) {
      const pids = pids_carrying(runtime_dir);
      if (pids.length === 0) break;
      signal_all(pids, "SIGKILL");
      sleep_sync(20);
    }
    const left = pids_carrying(runtime_dir);
    if (left.length > 0) {
      console.error(`session ${name}: processes still carry ${runtime_dir} after SIGKILL: ${left.join(", ")}`);
      return;
    }
  } catch (error) {
    console.error(`session ${name}: kept ${runtime_dir}, its processes could not be listed: ${error.message}`);
    return;
  }
  rmSync(runtime_dir, { recursive: true, force: true });
}

// A killed run leaves its sessions behind. Stop each session whose owner file names a dead process.
// A live run is never touched. This process counts as dead, since a recycled pid can match an old leftover.
// A dir with no owner file is skipped. start_session writes the file right after it makes the dir, before any process starts.
export async function sweep_dead_sessions() {
  for (const entry of readdirSync("/tmp").filter((name) => name.startsWith(RUNTIME_PREFIX))) {
    const runtime_dir = join("/tmp", entry);
    const owner_pid = read_owner_pid(runtime_dir);
    if (!Number.isInteger(owner_pid) || (owner_pid !== process.pid && process_is_alive(owner_pid))) continue;
    console.log(`sweep: stopping ${entry.slice(RUNTIME_PREFIX.length)}, left by dead run ${owner_pid}`);
    await stop_runtime(runtime_dir).catch((error) => console.error(`sweep: ${error.message}`));
  }
}

const RUN_DIR_PREFIX = "desertfox-key-run-";
const RUN_DIR_CARRIER_WAIT_MS = 3000;

// The processes that still carry the folder once they all left or the wait ran out. A failed /proc scan throws.
async function carriers_after_wait(run_dir, wait_ms) {
  const deadline = Date.now() + wait_ms;
  for (;;) {
    const pids = pids_carrying(run_dir);
    if (pids.length === 0 || Date.now() > deadline) return pids;
    await sleep(50);
  }
}

// The start time of a process in clock ticks since boot (field 22 of /proc/<pid>/stat), or undefined when it is gone.
// A pid that the kernel hands to a new process comes with a later start time, so the pair names one process.
function process_start_ticks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

// Makes the run folder of the calling coordinator, with an owner file that holds its pid and start time.
export function make_run_dir(tmp_root = tmpdir()) {
  const run_dir = mkdtempSync(join(tmp_root, RUN_DIR_PREFIX));
  writeFileSync(join(run_dir, OWNER_FILE), `${process.pid} ${process_start_ticks(process.pid)}\n`);
  return run_dir;
}

// A SIGKILLed coordinator leaves its run folder, over 1 GB of profiles and session files. This removes each run folder
// whose owner file names a process that is gone, or a pid that a newer process holds now.
// A folder with no readable owner file is skipped, as the session sweep skips a dir with no owner file.
// The workers of a SIGKILLed coordinator outlive it and stop their own sessions inside its folder. Their sessions write
// there as they stop and recreate the folder after a removal, with no owner file. So the sweep waits for every process
// that carries the folder in its environment (TMPDIR of a worker, HOME of a session process) to go, and skips the
// folder if one stays. The owner file stays with it, so the next sweep tries again.
export async function sweep_dead_run_dirs(tmp_root = tmpdir(), { carrier_wait_ms = RUN_DIR_CARRIER_WAIT_MS } = {}) {
  for (const entry of readdirSync(tmp_root).filter((name) => name.startsWith(RUN_DIR_PREFIX))) {
    const run_dir = join(tmp_root, entry);
    let owner_pid, owner_start_ticks;
    try {
      [owner_pid, owner_start_ticks] = readFileSync(join(run_dir, OWNER_FILE), "utf8").trim().split(" ");
    } catch {
      continue;
    }
    if (!/^\d+$/.test(owner_pid) || !/^\d+$/.test(owner_start_ticks ?? "")) continue;
    if (process_start_ticks(Number(owner_pid)) === owner_start_ticks) continue;
    let carriers;
    try {
      carriers = await carriers_after_wait(run_dir, carrier_wait_ms);
    } catch (error) {
      console.error(`sweep: keeping ${entry} of dead run ${owner_pid}, its processes could not be listed: ${error.message}`);
      continue;
    }
    if (carriers.length > 0) {
      console.log(`sweep: keeping ${entry} of dead run ${owner_pid}, processes still use it: ${carriers.join(", ")}`);
      continue;
    }
    console.log(`sweep: removing ${entry}, left by dead run ${owner_pid}`);
    try {
      // The removal still retries, for a writer that carries no path to the folder in its environment.
      // The owner file goes last: a removal that fails midway leaves the folder to the next sweep instead of owner-less.
      const retry = { recursive: true, force: true, maxRetries: 20, retryDelay: 250 };
      for (const name of readdirSync(run_dir).filter((name) => name !== OWNER_FILE)) rmSync(join(run_dir, name), retry);
      rmSync(run_dir, retry);
    } catch (error) {
      console.error(`sweep: ${error.message}`);
    }
  }
}

// NVIDIA's node fails nested GBM allocation, so the first render node of another driver wins.
function pick_render_node() {
  if (process.env.KEY_TEST_RENDER_NODE) return process.env.KEY_TEST_RENDER_NODE;
  for (const node of readdirSync("/sys/class/drm").filter((name) => name.startsWith("renderD")).sort()) {
    const driver = basename(readlinkSync(`/sys/class/drm/${node}/device/driver`));
    if (driver !== "nvidia") return `/dev/dri/${node}`;
  }
  throw new Error("no non-NVIDIA render node under /sys/class/drm; set KEY_TEST_RENDER_NODE=/dev/dri/renderD...");
}

// The output starts disabled and a reload enables it once the host's first configure is acked. Aquamarine otherwise
// commits a buffer before it acks, which the host rejects.
const hyprland_config = (runtime_dir) => `local enabled = io.open("${runtime_dir}/output-enabled") ~= nil
hl.monitor({ output = "${OUTPUT}", disabled = not enabled, mode = "1920x1080@60", position = "0x0", scale = "1" })
hl.config({
  misc = { disable_hyprland_logo = true, disable_splash_rendering = true, disable_watchdog_warning = true },
  ecosystem = { no_update_news = true, no_donation_nag = true },
  xwayland = { enabled = false },
})
`;

const tail_of = (path) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-10).join("\n") : "");

// Starts one session. `session_dir` holds its HOME, logs and configs, and the caller removes it. stop() ends every
// process of the session and removes the runtime dir. A failed start stops what it started before it throws.
export async function start_session({ name, session_dir }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > MAX_NAME_LENGTH) throw new Error(`session name "${name}" must be lowercase letters, digits and dashes, at most ${MAX_NAME_LENGTH} characters`);
  const runtime_dir = runtime_dir_of(name);
  const owner_pid = read_owner_pid(runtime_dir);
  if (owner_pid && owner_pid !== process.pid && process_is_alive(owner_pid)) throw new Error(`session ${name} belongs to live process ${owner_pid}`);
  if (existsSync(runtime_dir)) await stop_runtime(runtime_dir);
  mkdirSync(runtime_dir, { mode: 0o700 });
  writeFileSync(join(runtime_dir, OWNER_FILE), String(process.pid));

  const home = join(session_dir, "home");
  const logs = join(session_dir, "logs");
  for (const dir of [home, logs, join(session_dir, "labwc"), join(session_dir, "hypr")]) mkdirSync(dir, { recursive: true });
  // Built from nothing, so no variable of the caller's own session (WAYLAND_DISPLAY, the bus, Hyprland) leaks in.
  const base_env = {
    HOME: home, USER: userInfo().username, LOGNAME: userInfo().username, PATH: SYSTEM_PATH, LANG: process.env.LANG || "C.UTF-8", TERM: "dumb",
    XDG_RUNTIME_DIR: runtime_dir, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local/share"),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime_dir}/bus`,
    // Firefox's GIO call would otherwise make the session bus start gvfsd, which mounts gvfsd-fuse under the runtime dir. A kill leaves that mount stale, and the dir can no longer be removed.
    GIO_USE_VFS: "local", GVFS_DISABLE_FUSE: "1",
    HYPRLAND_NO_SD_VARS: "1", HYPRLAND_NO_SD_NOTIFY: "1", HYPRLAND_NO_CRASHREPORTER: "1",
    // Seat access stays inside the session: no seatd socket exists there, so nothing grabs a real seat.
    LIBSEAT_BACKEND: "seatd", SEATD_SOCK: `${runtime_dir}/no-seatd.sock`,
  };
  const client_groups = new Set();
  let client_env;
  let keyboard;

  // Each child gets its own session and process group, as with setsid, so a signal to the caller's group misses it.
  function start_child(argv, env, log_name, { client = false } = {}) {
    const log_fd = openSync(join(logs, log_name), "a");
    const child = spawn(argv[0], argv.slice(1), { env, detached: true, stdio: ["ignore", log_fd, log_fd] });
    closeSync(log_fd);
    child.on("error", (error) => console.error(`session ${name}: ${argv[0]} failed to start: ${error.message}`));
    child.unref();
    if (client) client_groups.add(child.pid);
    return child;
  }

  let hypr_signature;
  const hyprctl = async (...args) => (await run_execfile("hyprctl", args, { env: { ...base_env, HYPRLAND_INSTANCE_SIGNATURE: hypr_signature }, timeout: 5000 })).stdout;
  const output_listed = async (...flags) => {
    try {
      return JSON.parse(await hyprctl("monitors", ...flags, "-j")).some((monitor) => monitor.name === OUTPUT);
    } catch {
      return false;
    }
  };

  async function stop() {
    keyboard?.mark_stopping();
    await stop_runtime(runtime_dir, client_groups);
  }

  try {
    start_child(["dbus-daemon", "--session", "--nofork", `--address=unix:path=${runtime_dir}/bus`], base_env, "dbus.log");
    await wait_until("the session bus", () => existsSync(join(runtime_dir, "bus")), { timeout_ms: 5000 });

    writeFileSync(join(session_dir, "labwc", "rc.xml"), "<labwc_config/>\n");
    // Headless counts as not nested to labwc, which would then push this env into the caller's systemd and D-Bus activation env.
    start_child(["labwc", "-C", join(session_dir, "labwc")], { ...base_env, WLR_BACKENDS: "headless", WLR_HEADLESS_OUTPUTS: "1", WLR_LIBINPUT_NO_DEVICES: "1", LABWC_UPDATE_ACTIVATION_ENV: "0", WLR_RENDER_DRM_DEVICE: pick_render_node() }, "host.log");
    const host_socket = () => readdirSync(runtime_dir).find((entry) => /^wayland-\d+$/.test(entry));
    await wait_until("labwc's socket", () => host_socket() !== undefined, { timeout_ms: 10000 });
    const host_display = join(runtime_dir, host_socket());

    const hypr_config = join(session_dir, "hypr", "hyprland.lua");
    writeFileSync(hypr_config, hyprland_config(runtime_dir));
    start_child(["Hyprland", "--config", hypr_config], { ...base_env, WAYLAND_DISPLAY: host_display }, "hypr.log");
    const hypr_dir = join(runtime_dir, "hypr");
    const signature_now = () => (existsSync(hypr_dir) ? readdirSync(hypr_dir).find((entry) => existsSync(join(hypr_dir, entry, ".socket.sock"))) : undefined);
    await wait_until("Hyprland's socket", () => signature_now() !== undefined, { timeout_ms: 15000 });
    hypr_signature = signature_now();
    // Headless labwc has no keyboard, so its seat never sends the nested Hyprland an event, and Hyprland stalls before
    // it lists its output. A tap from a short-lived virtual keyboard on the host gives the seat one.
    await wait_until(`Hyprland to list ${OUTPUT}`, async () => {
      if (await output_listed("all")) return true;
      await run_execfile("python3", ["-I", join(key_test_dir, "keyboard.py"), "--tap", "Shift_L"], { env: { ...base_env, WAYLAND_DISPLAY: host_display }, timeout: 5000 }).catch(() => undefined);
      return false;
    }, { timeout_ms: 15000, step_ms: 200 });
    await sleep(300);
    writeFileSync(join(runtime_dir, "output-enabled"), "");
    await hyprctl("reload");
    await wait_until(`${OUTPUT} to enable after the reload`, () => output_listed(), { timeout_ms: 10000 });
    const instance = JSON.parse(await hyprctl("instances", "-j")).find((entry) => entry.instance === hypr_signature);
    if (!instance?.wl_socket) throw new Error(`hyprctl instances lists no socket for ${hypr_signature}`);
    const wayland_display = join(runtime_dir, instance.wl_socket);
    client_env = { ...base_env, WAYLAND_DISPLAY: wayland_display, HYPRLAND_INSTANCE_SIGNATURE: hypr_signature };

    // Before Firefox, so Hyprland has a keyboard when the window maps.
    keyboard = await start_keyboard(client_env, client_groups);
    return {
      runtime_dir,
      wayland_display,
      hypr_signature,
      home,
      // Starts a client in the session, its output appended to logs/<log_name>.
      spawn: (argv, log_name = "spawn.log") => start_child(argv, client_env, log_name, { client: true }),
      press: (args) => keyboard.press(args),
      shot: (path) => run_execfile("grim", [path], { env: client_env, timeout: 10000 }),
      stop,
    };
  } catch (error) {
    const logs_text = ["dbus.log", "host.log", "hypr.log"].map((log) => [log, tail_of(join(logs, log))]).filter(([, text]) => text).map(([log, text]) => `== ${log}\n${text}`).join("\n");
    await stop().catch((stop_error) => console.error(`session ${name}: stop after a failed start: ${stop_error.message}`));
    throw new Error(`session ${name} failed to start: ${error.message}${logs_text ? `\n${logs_text}` : ""}`);
  }
}

// The keyboard client of one session. press() sends one wtype-style argument list and resolves once the compositor
// took every key. It rejects on a refused key, after KEY_REPLY_TIMEOUT_MS, and at once when the client is gone.
async function start_keyboard(env, client_groups) {
  const child = spawn("python3", ["-I", join(key_test_dir, "keyboard.py")], { env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  client_groups.add(child.pid);
  const pending = new Map();
  let next_id = 1;
  let stderr_tail = "";
  let gone_reason;
  let stopping = false;
  let on_ready;
  const ready = new Promise((resolve_ready, reject_ready) => { on_ready = { resolve_ready, reject_ready }; });

  child.stderr.on("data", (chunk) => { stderr_tail = (stderr_tail + chunk).slice(-2000); });
  // A write to a client that just died fails here. The exit handler reports it.
  child.stdin.on("error", () => undefined);
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.ready) return on_ready.resolve_ready();
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.ok) waiter.resolve(message.sent);
    else waiter.reject(new Error(`keyboard refused ${JSON.stringify(waiter.args)}: ${message.error}`));
  });
  child.on("exit", (code, signal) => {
    gone_reason = `the keyboard client exited (${signal ? `signal ${signal}` : `exit ${code}`})${stderr_tail.trim() ? `: ${stderr_tail.trim()}` : ""}`;
    if (!stopping) console.error(gone_reason);
    on_ready.reject_ready(new Error(gone_reason));
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(gone_reason));
    }
    pending.clear();
  });
  const startup_timer = setTimeout(() => on_ready.reject_ready(new Error("the keyboard client was not ready within 10 s")), 10000);
  try {
    await ready;
  } finally {
    clearTimeout(startup_timer);
  }

  function press(args) {
    if (gone_reason) return Promise.reject(new Error(gone_reason));
    return new Promise((resolve_press, reject_press) => {
      const id = next_id++;
      // A -d delay between characters stretches a call, so the timeout grows with the text.
      const timeout_ms = KEY_REPLY_TIMEOUT_MS + 50 * args.join("").length;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject_press(new Error(`the keyboard client did not answer ${JSON.stringify(args)} within ${timeout_ms} ms`));
      }, timeout_ms);
      pending.set(id, { resolve: resolve_press, reject: reject_press, timer, args });
      child.stdin.write(`${JSON.stringify({ id, args })}\n`);
    });
  }
  return { press, mark_stopping: () => { stopping = true; } };
}
