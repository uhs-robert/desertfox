import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// `flock` exits with this code when the wait ran out, so the busy case is told from a failure of the command itself.
export const LOCK_BUSY_EXIT = 75;
export const LOCK_HELD_ENV = "OWNER_TEST_LOCK_HELD";
export const LOCK_WAIT_SECONDS = 180;

// One lifecycle action at a time per worktree, held by the kernel: it drops the lock when the process dies, so a crashed call never leaves a stale lock. `-o` closes the lock fd before the command runs, so nothing the command starts (the detached web-ext, the systemd unit) inherits the lock and holds it for the window's whole life.
export function flock_argv(lock_file: string, command: string[], wait_seconds = LOCK_WAIT_SECONDS): string[] {
  mkdirSync(dirname(lock_file), { recursive: true });
  return ["-w", String(wait_seconds), "-E", String(LOCK_BUSY_EXIT), "-o", lock_file, ...command];
}
