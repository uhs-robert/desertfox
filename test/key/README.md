# test/key

Key tests. Each run builds the extension, starts Firefox in its own nested, invisible session, sends real key presses and checks what the page and the background report. `run.mjs` holds the cases, `server.mjs` and `rdp.mjs` read the results, `launch_firefox.sh` starts Firefox, and `user.js` and `config/` set up the test profile.

## Run

```bash
just key-test
KEY_TEST_ONLY=<regex> just key-test
```

It takes about a minute and needs a nested Hyprland.

- `KEY_TEST_ONLY` runs only the cases whose name matches. It also runs the cases marked `{ setup: true }`, which leave state that later cases read. The output tags those as `SETUP`.
- `SHADOW_SH` must name a script that runs `up|spawn|keys|down <name>` for a nested, invisible compositor session. It can also answer `status` with one `<name>: up|down ...` line per session, which the sweep reads.
  Cleanup of killed runs works only for drivers that keep a session's runtime dir in `/tmp/shadow-<uid>-<name>`.
  When `SHADOW_SH` is unset, the recipe uses `$HOME/dotfiles/.claude/skills/shadow/shadow.sh` if it is executable. With neither, it exits.
- Each run starts its own shadow session, so runs from different worktrees go in parallel with no lock.

## Traps

- Run key tests only in your own worktree. Never run two from one worktree: each `just key-test` rebuilds and clears that worktree's `dist/`.
- Do not wrap `just key-test` in `timeout`. The recipe already runs in a systemd scope with a memory cap of 8 GB, no swap and a time limit of 1800 seconds. Without a systemd user session it runs uncapped and says so.
- On the first run after a build, an early setup case can fail. Rerun once before you debug.
- Add-ons force-installed through the Firefox policy file can eat modifier chords in the shadow session. Disable them before you trust a chord result.
- The first-install Quick Start tab opens beside the first tab and shifts the tab order. That was the cause of #123: Alt+J wrapped to an empty tab instead of page a. The test config now sets `open_quick_start_on_install = false`, and `expect_exactly_one_visible` also checks the active tab URL, so an empty tab fails the case (#155).
- The sweep of leftover sessions stops only a session that carries the run's owner marker file, `desertfox-key-owner`, naming a dead run. A session with no marker is skipped, whatever its name, so cleanup never stops another tool's session. Keep that rule when you change cleanup code.
