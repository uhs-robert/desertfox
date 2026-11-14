---
name: owner-test
description: Open a real Firefox window with a worktree's build so the maintainer can test by hand, reload it after a rebuild, and close it when the maintainer is done. Use before any hands-on maintainer test.
---

# owner-test

The window shows on the maintainer's desktop, not in the nested key-test session. Each worktree has its own window and profile, so parallel agents do not collide.

1. Run `just owner-test <worktree> ':set name value' ...` once per test round. Pass one quoted `:set` argument for each command the maintainer must type. A typo in a hint fails at once. Never run it from the nested key-test session.
2. If it prints `WRONG BUILD` or fails, stop and report. Do not hand over a window that shows the signed beta.
3. Run `just owner-test-status <worktree>` right before the hand-over. It says `WRONG BUILD` if the signed beta took over. Then stop and report.
4. Give the maintainer what to look at, the exact keys, the printed `:set` commands and which setting needs a first-use grant. A fresh profile has no optional grant, so the maintainer grants once per `just owner-test`, not per reload.
5. After each fix run `just owner-test-reload <worktree>`. The window reloads in place and keeps its profile. Tell the maintainer it reloaded. The command prints the permissions now granted, so check that a grant survived.
6. When the maintainer says done, run `just owner-test-close <worktree>` and check that it printed `closed`. Never end a session with the window open.
7. Do not start Firefox or web-ext any other way. Do not put a profile in `/tmp`.

Running `just owner-test` again on the same worktree replaces that worktree's window with a new profile. Use the reload to keep the profile.

When the hands-on test compares DesertFox with the rivals, use `just compare <url>...` instead of `just owner-test`. It opens one window per tool. Add pages with `just compare-add <url>` and end with `just compare-close`, and check that each tool printed `closed`. Never leave the windows open. See `tools/measure/rivals/README.md`.
