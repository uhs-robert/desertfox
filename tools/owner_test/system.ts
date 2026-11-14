import { spawnSync } from "node:child_process";
import { rmSync, rmdirSync } from "node:fs";
import type { CloseDeps } from "./close.ts";
import { read_start_ticks } from "./process_guard.ts";

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function real_close_deps(): CloseDeps {
  return {
    read_start_ticks: (pid) => read_start_ticks(pid),
    signal: (pid, signal) => {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    },
    sleep,
    stop_unit: (unit) => {
      spawnSync("systemctl", ["--user", "stop", unit], { stdio: "ignore" });
      // "is-active" prints "active" or "activating" while the unit runs. A missing unit prints something else. Without systemctl there is no stdout and result.error is set. The unit may still run then (a unit-backed record means systemd existed at open), so the stop is unconfirmed and close keeps the profile and state.
      const result = spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" });
      return result.error === undefined && !/^activ/.test(result.stdout.trim());
    },
    remove_profile: (profile) => rmSync(profile, { recursive: true, force: true }),
    remove_window_files: (log, window_dir) => {
      rmSync(log, { force: true });
      try { rmdirSync(window_dir); } catch { /* not empty or gone */ }
    },
  };
}
