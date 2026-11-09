// Opt-in capture of the rare Firefox stall (KEY_TEST_STALL_CAPTURE=1). Off by default: a normal run never loads gdb or reads /proc.
// Firefox then runs as a child of gdb, because ptrace_scope 1 forbids attaching to it later. On the first "Firefox stopped answering the
// debugger" of a shard, this records one file: whether a second debugger connection gets answers, the /proc state of the parent and
// its descendants, and a gdb backtrace of every parent thread.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect_rdp, evaluate_in_chrome } from "./rdp.mjs";

export const FIREFOX_BINARY = "/usr/lib/firefox/firefox";
const GDB_DUMP_WAIT_MS = 60000;
const SECOND_CONNECTION_TIMEOUT_MS = 8000;
// Longer than the sum of the capture's own waits, so a teardown that waits for it never outlasts it.
export const CAPTURE_WAIT_MS = 120000;

let warned_without_gdb = false;

// "gdb" when Firefox is to run under gdb, "plain" otherwise. The warning for a missing gdb prints once per process.
export function stall_capture_mode() {
  if (process.env.KEY_TEST_STALL_CAPTURE !== "1") return "plain";
  const usable = spawnSync("gdb", ["--version"], { stdio: "ignore" }).status === 0 && existsSync(FIREFOX_BINARY);
  if (usable) return "gdb";
  if (!warned_without_gdb) {
    warned_without_gdb = true;
    console.log(`KEY_TEST_STALL_CAPTURE is on but gdb or ${FIREFOX_BINARY} is missing: running without the gdb dump`);
  }
  return "plain";
}

const read_text = (path) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

function process_table() {
  const table = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = read_text(`/proc/${entry}/stat`);
    if (!stat) continue;
    const after_name = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    table.set(Number(entry), { pid: Number(entry), comm: stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")")), ppid: Number(after_name[1]) });
  }
  return table;
}

function find_parent(table, debug_port) {
  for (const { pid, comm } of table.values()) {
    const cmdline = (read_text(`/proc/${pid}/cmdline`) ?? "").split("\0");
    if (comm === "firefox" && !cmdline.includes("-contentproc") && cmdline.join(" ").includes(`-start-debugger-server ${debug_port}`)) return pid;
  }
  return undefined;
}

function descendants_of(table, root) {
  const found = [root];
  for (let i = 0; i < found.length; i++) for (const { pid, ppid } of table.values()) if (ppid === found[i]) found.push(pid);
  return found;
}

function proc_snapshot(pids) {
  const lines = [];
  for (const pid of pids) {
    const cmdline = (read_text(`/proc/${pid}/cmdline`) ?? "").split("\0").join(" ").slice(0, 160);
    if (!existsSync(`/proc/${pid}`)) continue;
    lines.push(`## pid ${pid} ${cmdline}`);
    lines.push(...(read_text(`/proc/${pid}/status`) ?? "").split("\n").filter((line) => /^(State|Threads|VmRSS)/.test(line)));
    for (const tid of safe_list(`/proc/${pid}/task`)) {
      const stat = read_text(`/proc/${pid}/task/${tid}/stat`);
      if (!stat) continue;
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      lines.push(`${tid} ${(read_text(`/proc/${pid}/task/${tid}/comm`) ?? "").trim().padEnd(18)} state=${fields[0]} utime=${fields[11]} stime=${fields[12]} wchan=${(read_text(`/proc/${pid}/task/${tid}/wchan`) ?? "").trim()}`);
    }
  }
  return lines.join("\n");
}

function safe_list(path) {
  try { return readdirSync(path); } catch { return []; }
}

async function second_connection_report(debug_port) {
  const lines = [];
  const step = async (name, run) => {
    const start = Date.now();
    try {
      lines.push(`${name}: ok in ${Date.now() - start} ms: ${JSON.stringify(await run()).slice(0, 300)}`);
    } catch (error) {
      lines.push(`${name}: FAIL in ${Date.now() - start} ms: ${error.message}`);
    }
  };
  let second;
  await step("connect and greeting", async () => { second = await connect_rdp(debug_port, { request_timeout_ms: SECOND_CONNECTION_TIMEOUT_MS }); return "connected"; });
  if (second) {
    await step("root getRoot", () => second.request("root", { type: "getRoot" }).then((reply) => Object.keys(reply)));
    await step("root listTabs", () => second.request("root", { type: "listTabs" }).then((reply) => reply.tabs?.map((tab) => tab.url)));
    await step("chrome eval 1 + 1", () => evaluate_in_chrome(second, "1 + 1"));
    second.close();
  }
  return lines.join("\n");
}

// SIGINT to the parent stops it under gdb, which then prints the backtraces from its batch commands and kills it. Returns the gdb log.
async function gdb_dump(parent, gdb_log) {
  const gdb_pid = process_table().get(parent)?.ppid;
  if (!gdb_pid || process_table().get(gdb_pid)?.comm !== "gdb") return `no gdb above pid ${parent}`;
  process.kill(parent, "SIGINT");
  const deadline = Date.now() + GDB_DUMP_WAIT_MS;
  while (existsSync(`/proc/${gdb_pid}`) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  const finished = !existsSync(`/proc/${gdb_pid}`);
  return `${finished ? "gdb finished" : `gdb still running after ${GDB_DUMP_WAIT_MS / 1000} s`}\n${read_text(gdb_log) ?? "no gdb log"}`;
}

// `gdb_log` is the file launch_firefox.sh writes. The capture runs once, on the first note_lost with a stall reason; settled() resolves when it is done or after max_wait_ms.
export function create_stall_capture({ debug_port, gdb_log, out_dir, label }) {
  let capture;
  async function run_capture() {
    const started = new Date();
    const sections = [`stall capture ${label}, port ${debug_port}, ${started.toISOString()}`];
    const parent = find_parent(process_table(), debug_port);
    sections.push(`firefox parent pid: ${parent ?? "not found"}`);
    if (parent === undefined) return sections;
    const pids = descendants_of(process_table(), parent);
    sections.push(`# /proc before the second connection\n${proc_snapshot(pids)}`);
    sections.push(`# second debugger connection\n${await second_connection_report(debug_port)}`);
    sections.push(`# /proc after the second connection\n${proc_snapshot(pids)}`);
    sections.push(`# gdb\n${await gdb_dump(parent, gdb_log)}`);
    return sections;
  }
  return {
    note_lost(reason) {
      if (capture || !/stopped answering/.test(reason ?? "")) return;
      capture = (async () => {
        let path;
        try {
          const sections = await run_capture();
          mkdirSync(out_dir, { recursive: true });
          path = join(out_dir, `stall-${label}-${Date.now()}.txt`);
          writeFileSync(path, `${sections.join("\n\n")}\n`);
          console.log(`stall capture written to ${path}`);
        } catch (error) {
          console.log(`stall capture failed: ${error.message}`);
        }
      })();
    },
    async settled(max_wait_ms = CAPTURE_WAIT_MS) {
      if (capture) await Promise.race([capture, new Promise((resolve) => setTimeout(resolve, max_wait_ms))]);
    },
  };
}
