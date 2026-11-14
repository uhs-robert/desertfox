---
name: owner-test
description: Open a real Firefox window with a worktree's build so the owner can test by hand, reload it after a rebuild, and close it when the owner is done. Use before any hands-on owner test.
---

# owner-test

The window shows on the owner's desktop, not in the nested key-test session. Each worktree has its own window and profile, so parallel agents do not collide.

1. Run `just owner-test <worktree> ':set name value' ...` once per test round. Pass one quoted `:set` argument for each command the owner must type. A typo in a hint fails at once. Never run it from the nested key-test session.
2. If it prints `WRONG BUILD` or fails, stop and report. Do not hand over a window that shows the signed beta.
3. Give the owner what to look at, the exact keys, the printed `:set` commands and which setting needs a first-use grant. A fresh profile has no optional grant, so the owner grants once per `just owner-test`, not per reload.
4. After each fix run `just owner-test-reload <worktree>`. The window reloads in place and keeps its profile. Tell the owner it reloaded. The command prints the permissions now granted, so check that a grant survived.
5. When the owner says done, run `just owner-test-close <worktree>` and check that it printed `closed`. Never end a session with the window open.
6. Do not start Firefox or web-ext any other way. Do not put a profile in `/tmp`.

Running `just owner-test` again on the same worktree replaces that worktree's window with a new profile. Use the reload to keep the profile.
