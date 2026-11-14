import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Zero pids mean "not started yet": the file is written before any process starts, so a crash after the spawn leaves a trail.
export type WindowState = {
  worktree: string;
  profile: string;
  log: string;
  stamp: string;
  started: string;
  unit: string | null;
  web_ext_pid: number;
  web_ext_start_ticks: number;
  firefox_pid: number;
  firefox_start_ticks: number;
};

export type ReadState = { kind: "none" } | { kind: "corrupt"; reason: string } | { kind: "ok"; state: WindowState };

const STRING_FIELDS = ["worktree", "profile", "log", "stamp", "started"] as const;
const NUMBER_FIELDS = ["web_ext_pid", "web_ext_start_ticks", "firefox_pid", "firefox_start_ticks"] as const;

export function read_state(state_file: string): ReadState {
  if (!existsSync(state_file)) return { kind: "none" };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(state_file, "utf8"));
  } catch (error) {
    return { kind: "corrupt", reason: (error as Error).message };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "corrupt", reason: "not an object" };
  for (const field of STRING_FIELDS) if (typeof parsed[field] !== "string") return { kind: "corrupt", reason: `${field} is not a string` };
  for (const field of NUMBER_FIELDS) if (!Number.isInteger(parsed[field])) return { kind: "corrupt", reason: `${field} is not an integer` };
  if (parsed.unit !== null && typeof parsed.unit !== "string") return { kind: "corrupt", reason: "unit is neither null nor a string" };
  return { kind: "ok", state: parsed as unknown as WindowState };
}

// A temp file in the same folder, then a rename, so a reader never sees half a file.
export function write_state(state_file: string, state: WindowState): void {
  mkdirSync(dirname(state_file), { recursive: true });
  const temp = `${state_file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, state_file);
}

export function remove_state(state_file: string): void {
  rmSync(state_file, { force: true });
}
