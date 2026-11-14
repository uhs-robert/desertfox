# owner_test

Opens a real Firefox window on the owner's desktop with one worktree's build, so the owner can test by hand. Each worktree has its own window, profile and state, keyed by the worktree path. Two worktrees never touch each other's window.

```
just owner-test [worktree] [':set name value']...   # build, then open (replaces this worktree's own window)
just owner-test-reload [worktree]                   # rebuild and reload in place
just owner-test-status [worktree]
just owner-test-close [worktree]                    # stop the window and delete its profile
```

The agent workflow is in `.claude/skills/owner-test/SKILL.md`.

## How it works

- `cli.ts`: the four actions. It builds, stamps `dist/manifest.json` with a `version_name`, starts `web-ext run` in a systemd user unit (plain detached spawn when systemd is missing), and checks the loaded build over the debugger.
- `paths.ts`: the state file (`$XDG_STATE_HOME/desertfox/owner-test/<key>.json`) and the profile and log folder (`$XDG_CACHE_HOME/desertfox/owner-test/<key>/`) for a worktree.
- `state.ts`: the state file, written atomically with mode 0600 before any process starts.
- `process_guard.ts`: a recorded pid counts only while its start ticks (field 22 of `/proc/<pid>/stat`) still match, so a recycled pid is never signalled.
- `close.ts`: stops the processes, then deletes the profile only when the state names the exact profile folder its own worktree maps to under the owner-test cache root.
- `profile.ts`: the profile `user.js`, seeded from `test/key/user.js` with the new tab, start page and notification lines dropped.
- `hints.ts`: checks each `:set` hint against the settings table, so a typo fails at open time.
- `web_ext.ts`: the web-ext arguments and the manifest stamp.
- `probe.ts`: judges the debugger's answer. The system policy pins a signed beta under the same add-on id, so only a temporary install with this build's stamp counts.

Reload uses web-ext's `--watch-file` on `dist/.owner-test-reload`, which the script writes after the build ends.

The cli imports `connect_rdp` and `evaluate_in_background` from `test/key/rdp.mjs` instead of copying them.
