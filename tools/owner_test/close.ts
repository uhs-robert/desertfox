import { is_strictly_inside, window_paths, type Roots } from "./paths.ts";
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
};

export type CloseResult = { lines: string[]; closed: boolean };

const POLL_MS = 100;

// SIGTERM, wait, SIGKILL, and re-read the start ticks before each signal, so a pid recycled in between is never hit.
async function stop_process(label: string, pid: number, start_ticks: number, deps: CloseDeps, lines: string[]): Promise<void> {
  const still_ours = () => start_ticks > 0 && deps.read_start_ticks(pid) === start_ticks;
  if (pid <= 1 || start_ticks <= 0) return void lines.push(`${label}: never started`);
  if (!still_ours()) {
    lines.push(deps.read_start_ticks(pid) === null ? `${label}: already gone` : `${label}: pid ${pid} now belongs to another process, left alone`);
    return;
  }
  deps.signal(pid, "SIGTERM");
  const grace_ms = deps.grace_ms ?? 5000;
  for (let waited = 0; waited < grace_ms && still_ours(); waited += POLL_MS) await deps.sleep(POLL_MS);
  if (still_ours()) {
    deps.signal(pid, "SIGKILL");
    lines.push(`${label}: killed`);
  } else {
    lines.push(`${label}: stopped`);
  }
}

// The only profile a state may name is the one its own worktree maps to, below the owner-test cache root. A bad or foreign state file therefore deletes nothing.
export function own_profile(state: WindowState, roots: Roots): string | null {
  const paths = window_paths(state.worktree, roots);
  const named = resolve(state.profile);
  return named === paths.profile_dir && is_strictly_inside(paths.cache_root, named) ? named : null;
}

export async function close_window(state_file: string, roots: Roots, deps: CloseDeps): Promise<CloseResult> {
  const read = read_state(state_file);
  const lines: string[] = [];
  if (read.kind === "none") return { lines: ["nothing open"], closed: false };
  if (read.kind === "corrupt") {
    remove_state(state_file);
    return { lines: [`state file was unreadable (${read.reason}) and is removed; no process was stopped and no folder was deleted`], closed: false };
  }
  const state = read.state;
  await stop_process("web-ext", state.web_ext_pid, state.web_ext_start_ticks, deps, lines);
  await stop_process("firefox", state.firefox_pid, state.firefox_start_ticks, deps, lines);
  if (state.unit !== null) deps.stop_unit(state.unit);
  const profile = own_profile(state, roots);
  if (profile === null) {
    lines.push(`profile: ${state.profile} is not this worktree's profile under the owner-test cache, left alone`);
  } else {
    deps.remove_profile(profile);
    const paths = window_paths(state.worktree, roots);
    deps.remove_window_files(paths.log_file, paths.window_dir);
    lines.push(`profile: deleted ${profile}`);
  }
  remove_state(state_file);
  lines.push("closed");
  return { lines, closed: true };
}
