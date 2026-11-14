import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { is_same_process, read_start_ticks } from "./process_guard.ts";

type Holder = { pid: number; start_ticks: number };

function read_holder(lock_file: string): Holder | null {
  try {
    const parsed = JSON.parse(readFileSync(lock_file, "utf8"));
    return Number.isInteger(parsed.pid) && Number.isInteger(parsed.start_ticks) ? parsed : null;
  } catch {
    return null;
  }
}

export class LockBusy extends Error {}

export type LockOptions = { timeout_ms?: number; sleep?: (ms: number) => Promise<void>; proc_root?: string };

// A holder is stale when its process is gone or its pid now has other start ticks (the same recycled-pid guard as close). An unreadable lock file has no live holder either.
function holder_is_stale(holder: Holder | null, proc_root: string): boolean {
  return holder === null || !is_same_process(holder.pid, holder.start_ticks, proc_root);
}

// Moves the stale lock aside, which only one waiter can do. If the file moved turns out to be a fresh lock that another waiter just made, it goes back.
function clear_stale(lock_file: string, judged: Holder | null, proc_root: string): void {
  const aside = `${lock_file}.stale.${process.pid}`;
  try {
    renameSync(lock_file, aside);
  } catch {
    return;
  }
  const moved = read_holder(aside);
  if (holder_is_stale(moved, proc_root) || (judged !== null && moved?.pid === judged.pid && moved.start_ticks === judged.start_ticks)) {
    rmSync(aside, { force: true });
    return;
  }
  try {
    linkSync(aside, lock_file);
  } catch { /* another lock took the place; the live holder keeps its own */ }
  rmSync(aside, { force: true });
}

// One lifecycle action at a time per worktree. Waits up to `timeout_ms` for a live holder, then fails naming it.
export async function with_lock<T>(lock_file: string, action: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const { timeout_ms = 180_000, sleep = (ms) => new Promise<void>((done) => setTimeout(done, ms)), proc_root = "/proc" } = options;
  mkdirSync(dirname(lock_file), { recursive: true });
  const mine = JSON.stringify({ pid: process.pid, start_ticks: read_start_ticks(process.pid, proc_root) ?? 0 });
  const deadline = Date.now() + timeout_ms;
  for (;;) {
    try {
      const fd = openSync(lock_file, "wx", 0o600);
      writeSync(fd, mine);
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = read_holder(lock_file);
    if (holder_is_stale(holder, proc_root)) {
      clear_stale(lock_file, holder, proc_root);
      continue;
    }
    if (Date.now() >= deadline) throw new LockBusy(`another owner-test call on this worktree is still running (pid ${holder?.pid})`);
    await sleep(200);
  }
  try {
    return await action();
  } finally {
    // Remove it only while it is still ours.
    try {
      if (readFileSync(lock_file, "utf8") === mine) rmSync(lock_file, { force: true });
    } catch { /* already gone */ }
  }
}
