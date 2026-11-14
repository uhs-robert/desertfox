// The parts of owner-test that touch the machine: starting a process in a systemd unit, finding Firefox by profile, signalling, and the desktop check. Shared with tools/measure/rivals/compare.mjs.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import type { CloseDeps } from "./close.ts";
import { read_start_ticks } from "./process_guard.ts";
import { Refusal } from "./refusal.ts";

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// Only a state that says the unit is down confirms a stop. "inactive" is also what an unknown unit prints. Empty output (no systemctl, no user bus) and the running or transitional states ("active", "activating", "deactivating", "reloading") prove nothing, and close then keeps the profile and state.
export function is_confirmed_stopped(is_active_output: string): boolean {
  return ["inactive", "failed"].includes(is_active_output.trim());
}

// The window must show on the maintainer's desktop. The nested key-test session keeps its runtime dir under /tmp.
export function check_environment(who: string): void {
  if (!process.env.WAYLAND_DISPLAY) throw new Refusal("WAYLAND_DISPLAY is not set, so there is no desktop to open a window on.");
  if (process.env.DESERTFOX_CONFIG_DIR || (process.env.XDG_RUNTIME_DIR ?? "").startsWith("/tmp/")) throw new Refusal(`this looks like the nested key-test session. Run ${who} from the maintainer's own session.`);
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

// The Firefox that runs with this profile and a debugger port.
export function firefox_pid_for(profile: string): number | null {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const words = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      if (words.includes("-start-debugger-server") && words.includes(profile)) return Number(entry);
    } catch { /* the process ended */ }
  }
  return null;
}

export type UnitSpec = { unit: string; command: string; args: string[]; cwd: string; log_file: string; who: string };

// Through a systemd user unit when possible, so the process outlives the agent's own scope and has a memory cap. Plain detached spawn otherwise.
export function start_unit(spec: UnitSpec): { unit: string | null; pid: number } {
  const env_args = ["WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DISPLAY", "HOME", "PATH", "DBUS_SESSION_BUS_ADDRESS", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]
    .filter((name) => process.env[name]).map((name) => `--setenv=${name}=${process.env[name]}`);
  const unit_run = spawnSync("systemd-run", [
    "--user", "--collect", "--quiet", `--unit=${spec.unit}`, "-p", "MemoryMax=4G", `--working-directory=${spec.cwd}`,
    "-p", `StandardOutput=append:${spec.log_file}`, "-p", `StandardError=append:${spec.log_file}`,
    ...env_args, "--", spec.command, ...spec.args,
  ], { stdio: "ignore" });
  if (unit_run.status === 0) {
    const pid = Number(spawnSync("systemctl", ["--user", "show", "-p", "MainPID", "--value", spec.unit], { encoding: "utf8" }).stdout.trim());
    return { unit: spec.unit, pid: pid || 0 };
  }
  console.error(`${spec.who}: systemd-run failed, so the window runs without a systemd unit and may end with this session.`);
  const log_fd = openSync(spec.log_file, "a");
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, detached: true, stdio: ["ignore", log_fd, log_fd] });
  child.unref();
  closeSync(log_fd);
  return { unit: null, pid: child.pid ?? 0 };
}
