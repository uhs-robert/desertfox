import { spawnSync } from "node:child_process";
import { rmSync, rmdirSync } from "node:fs";
import type { CloseDeps } from "./close.ts";
import { read_start_ticks } from "./process_guard.ts";

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// Only a state that says the unit is down confirms a stop. "inactive" is also what an unknown unit prints. Empty output (no systemctl, no user bus) and the running or transitional states ("active", "activating", "deactivating", "reloading") prove nothing, and close then keeps the profile and state.
export function is_confirmed_stopped(is_active_output: string): boolean {
  return ["inactive", "failed"].includes(is_active_output.trim());
}

export function real_close_deps(): CloseDeps {
  return {
    read_start_ticks: (pid) => read_start_ticks(pid),
    signal: (pid, signal) => {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    },
    sleep,
    stop_unit: (unit) => {
      spawnSync("systemctl", ["--user", "stop", unit], { stdio: "ignore" });
      const result = spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" });
      return result.error === undefined && is_confirmed_stopped(result.stdout);
    },
    remove_profile: (profile) => rmSync(profile, { recursive: true, force: true }),
    remove_window_files: (log, window_dir) => {
      rmSync(log, { force: true });
      try { rmdirSync(window_dir); } catch { /* not empty or gone */ }
    },
  };
}
