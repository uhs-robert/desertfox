import { is_strictly_inside, unit_name, type WindowPaths } from "./paths.ts";
import { remove_state, read_state, type WindowState } from "./state.ts";
import { resolve } from "node:path";

// Everything that touches the system, so tests can fake it.
export type CloseDeps = {
  read_start_ticks: (pid: number) => number | null;
  signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  sleep: (ms: number) => Promise<void>;
  stop_unit: (unit: string) => void;
  remove_profile: (profile: string) => void;
  remove_window_files: (log: string, window_dir: string) => void;
  grace_ms?: number;
  // How long to wait for the process to be gone after SIGKILL.
  kill_wait_ms?: number;
};

export type CloseResult = { lines: string[]; closed: boolean };

const POLL_MS = 100;

// SIGTERM, wait, SIGKILL, and re-read the start ticks before each signal, so a pid recycled in between is never hit. Returns false when the process still runs after SIGKILL and a bounded wait: the caller then keeps the profile and state.
async function stop_process(label: string, pid: number, start_ticks: number, deps: CloseDeps, lines: string[]): Promise<boolean> {
  const still_ours = () => start_ticks > 0 && deps.read_start_ticks(pid) === start_ticks;
  const wait_until_gone = async (limit_ms: number) => {
    for (let waited = 0; waited < limit_ms && still_ours(); waited += POLL_MS) await deps.sleep(POLL_MS);
  };
  if (pid <= 1 || start_ticks <= 0) {
    lines.push(`${label}: never started`);
    return true;
  }
  if (!still_ours()) {
    lines.push(deps.read_start_ticks(pid) === null ? `${label}: already gone` : `${label}: pid ${pid} now belongs to another process, left alone`);
    return true;
  }
  deps.signal(pid, "SIGTERM");
  await wait_until_gone(deps.grace_ms ?? 5000);
  if (!still_ours()) {
    lines.push(`${label}: stopped`);
    return true;
  }
  deps.signal(pid, "SIGKILL");
  await wait_until_gone(deps.kill_wait_ms ?? 3000);
  lines.push(still_ours() ? `${label}: still running after SIGKILL` : `${label}: killed`);
  return !still_ours();
}

// The profile a state may name is the one the caller's worktree maps to, below the owner-test cache root. A bad or foreign state file therefore deletes nothing. The worktree and unit come from the caller's paths, never from the file.
export function own_profile(state: WindowState, paths: WindowPaths): string | null {
  const named = resolve(state.profile);
  return named === paths.profile_dir && is_strictly_inside(paths.cache_root, named) ? named : null;
}

export async function close_window(paths: WindowPaths, deps: CloseDeps): Promise<CloseResult> {
  const read = read_state(paths.state_file);
  const lines: string[] = [];
  // The unit name is ours by construction, so stopping it is safe whatever the file says. It also clears a unit whose record was lost.
  deps.stop_unit(unit_name(paths.key));
  if (read.kind === "none") return { lines: ["nothing open"], closed: false };
  if (read.kind === "corrupt") {
    remove_state(paths.state_file);
    return { lines: [`state file was unreadable (${read.reason}) and is removed; no process was signalled and no folder was deleted`], closed: false };
  }
  const state = read.state;
  const web_ext_gone = await stop_process("web-ext", state.web_ext_pid, state.web_ext_start_ticks, deps, lines);
  const firefox_gone = await stop_process("firefox", state.firefox_pid, state.firefox_start_ticks, deps, lines);
  if (!web_ext_gone || !firefox_gone) {
    lines.push("close is incomplete: a process still runs, so the profile and state are kept. Run close again.");
    return { lines, closed: false };
  }
  const profile = own_profile(state, paths);
  if (profile === null) {
    lines.push(`profile: ${state.profile} is not this worktree's profile under the owner-test cache, left alone`);
  } else {
    deps.remove_profile(profile);
    deps.remove_window_files(paths.log_file, paths.window_dir);
    lines.push(`profile: deleted ${profile}`);
  }
  remove_state(paths.state_file);
  lines.push("closed");
  return { lines, closed: true };
}
