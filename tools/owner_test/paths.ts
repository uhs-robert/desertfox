import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, join, relative, resolve, isAbsolute, sep } from "node:path";

export type Roots = { state_home: string; cache_home: string };

export function default_roots(env: NodeJS.ProcessEnv, home: string): Roots {
  return {
    state_home: env.XDG_STATE_HOME || join(home, ".local", "state"),
    cache_home: env.XDG_CACHE_HOME || join(home, ".cache"),
  };
}

// The same worktree reached through a symlink must map to one window, so the key is taken from the real path.
export function canonical_worktree(worktree: string): string {
  return realpathSync(resolve(worktree));
}

// The name that keys one worktree's state file, profile folder and systemd unit. The hash of the full path keeps two worktrees with the same folder name apart.
export function worktree_key(worktree: string): string {
  const path = resolve(worktree);
  const readable = basename(path).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  return `${readable}-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;
}

export type WindowPaths = { worktree: string; key: string; lock_file: string; state_file: string; cache_root: string; window_dir: string; profile_dir: string; log_file: string };

export function window_paths(worktree: string, roots: Roots): WindowPaths {
  const key = worktree_key(worktree);
  const cache_root = join(roots.cache_home, "desertfox", "owner-test");
  const window_dir = join(cache_root, key);
  return {
    worktree: resolve(worktree),
    key,
    lock_file: join(roots.state_home, "desertfox", "owner-test", `${key}.lock`),
    state_file: join(roots.state_home, "desertfox", "owner-test", `${key}.json`),
    cache_root,
    window_dir,
    profile_dir: join(window_dir, "profile"),
    log_file: join(window_dir, "web-ext.log"),
  };
}

// True only for a path strictly below `root`. The root itself and any `..` escape fail.
export function is_strictly_inside(root: string, path: string): boolean {
  const from_root = relative(resolve(root), resolve(path));
  return from_root !== "" && !isAbsolute(from_root) && from_root.split(sep)[0] !== "..";
}

export function unit_name(key: string): string {
  return `desertfox-owner-test-${key}`;
}
