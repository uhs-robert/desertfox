# owner_test

Opens a real Firefox window on the maintainer's desktop with one worktree's build, so the maintainer can test by hand. Each worktree has its own window, profile and state, keyed by the worktree path. Two worktrees never touch each other's window.

```
just owner-test [worktree] [':set name value']... [--installed-host] [--empty-config]   # build, then open (replaces this worktree's own window)
just owner-test-reload [worktree]                   # rebuild and reload in place
just owner-test-status [worktree]                   # build, host path and config folder the window uses
just owner-test-close [worktree]                    # stop the window and delete its profile, private HOME and scratch config
```

The agent workflow is in `.claude/skills/owner-test/SKILL.md`.

## Host and config

By default a window runs the worktree's own `host/desertfox-host` against a scratch copy of `~/.config/desertfox`, so a host change is testable without touching the installed host or the real config.

- `--installed-host` runs the installed host and the real config, as the window did before.
- `--empty-config` starts the scratch config empty, for clean-install tests. It has no meaning with `--installed-host`.
- Each window gets a private `HOME` with its own native-messaging manifest. The XDG base folders stay the real ones, so GTK theme and fonts carry over. Other native hosts do not run in the window, and neither does the desktop bridge, so the `desertfox` command line does not reach it. Use `--installed-host` to test the bridge.

## How it works

- `cli.ts`: the four actions, each under a per-worktree lock (`lock.ts`, `flock`) except status. It builds, stamps `dist/manifest.json` with a `version_name`, starts `web-ext run` in a systemd user unit (plain detached spawn when systemd is missing), and checks the loaded build over the debugger.
- `paths.ts`: the state file (`$XDG_STATE_HOME/desertfox/owner-test/<key>.json`) and the profile and log folder (`$XDG_CACHE_HOME/desertfox/owner-test/<key>/`) for a worktree.
- `state.ts`: the state file, written atomically with mode 0600 before any process starts. A plain spawn that returns pid 0 started nothing, so open removes its state file and fails at once.
- `system.ts`: the real system calls close uses (`real_close_deps`), the window env allowlist and the desktop check. The key-test session marks its Firefox with `DESERTFOX_KEY_TEST`, and the check refuses on it. When `systemctl` cannot run, the unit counts as not confirmed stopped, so close keeps the profile and state and says to run it again.
- `process_guard.ts`: a recorded pid counts only while its start ticks (field 22 of `/proc/<pid>/stat`) still match, so a recycled pid is never signalled.
- `close.ts`: stops the processes, then deletes the profile, private HOME and scratch config only when the state names the exact folders its own worktree maps to under the owner-test cache root.
- `host_env.ts`: the private HOME manifest (same name, description and extension id as `host/install.sh`), the scratch config copy (links are followed, so a host write never reaches a linked real file), the env the window gets, and the status report of the host in use.
- `profile.ts`: the profile `user.js`, seeded from `test/key/user.js` with the new tab, start page and notification lines dropped.
- `hints.ts`: checks each `:set` hint against the settings table, so a typo fails at open time.
- `web_ext.ts`: the web-ext arguments and the manifest stamp. `--verbose` makes the web-ext log say why Firefox closed.
- `probe.ts`: judges the debugger's answer. The system policy pins a signed beta under the same add-on id, so only a temporary install with this build's stamp counts.

Reload asks the debugger to reload the add-on (`rdp_probe.ts`), after the build ends. web-ext runs with `--no-reload`, because its own watcher fires many times per build and ignores dotfiles. Every debugger call has a deadline, and `status` re-probes the loaded build.

The cli imports `connect_rdp` and `evaluate_in_background` from `test/key/rdp.mjs` instead of copying them.
