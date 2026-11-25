// The native host a test window runs. By default the window gets a private HOME holding a manifest that points at the worktree's own host, and a scratch copy of the config, so a host change is testable without touching the maintainer's installed host or config.

import { cpSync, existsSync, mkdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { is_strictly_inside, type WindowPaths } from "./paths.ts";

// Firefox on Linux reads a user's native-messaging manifests only from $HOME/.mozilla/native-messaging-hosts (and fixed system folders), so a private HOME is the one per-process redirect.
export const MANIFEST_RELATIVE = join(".mozilla", "native-messaging-hosts", "desertfox_host.json");

// The same name, description and extension id that host/install.sh writes for this host. A test compares them with install.sh, so a change there fails here.
export const HOST_MANIFEST_NAME = "desertfox_host";
export const HOST_MANIFEST_DESCRIPTION = "DesertFox config files and saved edits";
export const EXTENSION_ID = "desertfox@uhs-robert";

export type HostChoice = { installed_host: boolean; empty_config: boolean };

export function host_manifest(host_path: string) {
  return { name: HOST_MANIFEST_NAME, description: HOST_MANIFEST_DESCRIPTION, path: host_path, type: "stdio", allowed_extensions: [EXTENSION_ID] };
}

// The folder the installed host reads: DESERTFOX_CONFIG_DIR is never set here, a relative XDG_CONFIG_HOME is ignored (as the host does), and a missing folder means an empty config.
export function real_config_dir(env: NodeJS.ProcessEnv, home: string): string {
  const config_home = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith("/") ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(config_home, "desertfox");
}

// The base folders Firefox keeps using from the real home, so GTK theme, fonts and caches carry over while HOME is private.
export function pinned_xdg(env: NodeJS.ProcessEnv, home: string): Record<string, string> {
  return {
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME || join(home, ".config"),
    XDG_DATA_HOME: env.XDG_DATA_HOME || join(home, ".local", "share"),
    XDG_CACHE_HOME: env.XDG_CACHE_HOME || join(home, ".cache"),
  };
}

// Removes the window's own private HOME and scratch config, so a leftover of an earlier run never merges into a new copy. Only the two fixed folders under the cache root can go.
export function remove_own_host_dirs(paths: WindowPaths): void {
  for (const dir of [paths.home_dir, paths.config_dir]) if (is_strictly_inside(paths.cache_root, dir)) rmSync(dir, { recursive: true, force: true });
}

// A failed prepare leaves a state that close treats as "no process recorded, keep everything", so close cannot clean it. This removes the half-written folders, the profile and the state file directly.
export function discard_failed_prepare(paths: WindowPaths): void {
  remove_own_host_dirs(paths);
  if (is_strictly_inside(paths.cache_root, paths.profile_dir)) rmSync(paths.profile_dir, { recursive: true, force: true });
  rmSync(paths.log_file, { force: true });
  rmSync(paths.state_file, { force: true });
  try { rmdirSync(paths.window_dir); } catch { /* not empty or gone */ }
}

// Writes the private HOME and the scratch config. The copy follows links (dereference), so a write by the host can never reach a file the real config only links to.
export function prepare_host_dirs(paths: WindowPaths, worktree: string, real_config: string, choice: HostChoice): void {
  remove_own_host_dirs(paths);
  const manifest_file = join(paths.home_dir, MANIFEST_RELATIVE);
  mkdirSync(dirname(manifest_file), { recursive: true, mode: 0o700 });
  writeFileSync(manifest_file, JSON.stringify(host_manifest(join(worktree, "host", "desertfox-host")), null, 2));
  mkdirSync(paths.config_dir, { recursive: true, mode: 0o700 });
  if (!choice.empty_config && existsSync(real_config)) cpSync(real_config, paths.config_dir, { recursive: true, dereference: true });
}

// What start_unit sets on the window. Installed-host mode changes nothing, as before.
export function window_env(paths: WindowPaths, choice: HostChoice, env: NodeJS.ProcessEnv, real_home: string): Record<string, string> {
  // An empty value drops the caller's own DESERTFOX_CONFIG_DIR, so the installed host reads the real config.
  if (choice.installed_host) return { DESERTFOX_CONFIG_DIR: "" };
  return { ...pinned_xdg(env, real_home), HOME: paths.home_dir, DESERTFOX_CONFIG_DIR: paths.config_dir };
}

// /proc/<pid>/environ is NUL-separated NAME=value entries.
export function parse_environ(text: string): Record<string, string> {
  const entries = text.split("\0").filter((entry) => entry.includes("="));
  return Object.fromEntries(entries.map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
}

export type HostReport = { host_path: string; config_dir: string };

// What the running Firefox uses, from its own environment and the manifest in its HOME. An installed-host window has no private HOME to read, so it says so.
export function describe_host(firefox_environ: Record<string, string>, read_manifest: (file: string) => string | null): HostReport {
  const home = firefox_environ.HOME ?? "(no HOME)";
  const manifest_text = read_manifest(join(home, MANIFEST_RELATIVE));
  const manifest_path = manifest_text === null ? null : (JSON.parse(manifest_text) as { path?: string }).path;
  return {
    host_path: manifest_path ?? "(no manifest in this HOME)",
    config_dir: firefox_environ.DESERTFOX_CONFIG_DIR ?? "(not set: the host reads the real config)",
  };
}
