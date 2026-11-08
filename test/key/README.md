# test/key

Key tests. Each run builds the extension, starts Firefox in its own nested, invisible session, sends real key presses and checks what the page and the background report. `harness.mjs` holds the session (`create_session`: Firefox, the page server, the helpers and `run_piece` with the piece lifecycle), `run.mjs` holds the order of the run and the summary, `p<number>_*.mjs` are the pieces, `areas.mjs` maps src files to areas, `timings.mjs` measures where the time goes, `server.mjs` and `rdp.mjs` read the results, `launch_firefox.sh` starts Firefox, and `user.js` and `config/` set up the test profile.

## Run

```bash
just key-test
KEY_TEST_ONLY=<regex> just key-test
KEY_TEST_PIECES=p7_caret,p11_find just key-test
KEY_TEST_ORDER=reverse just key-test
just key-test-changed [base] [head]
```

A full run takes about 20 minutes (1143 s for 241 cases in the latest run) and needs a nested Hyprland. The key-test-speed work (#273) brings that down.

- `KEY_TEST_ONLY` runs only the cases whose name matches. It also runs the cases marked `{ setup: true }` and every `h.setup` step of a piece, which leave state that later cases read. The output tags those as `SETUP`.
- `KEY_TEST_PIECES` is a comma-separated list of piece names (the file name without `.mjs`). Only those pieces run, and an unknown name or an empty list aborts the run. Each piece must pass alone.
- `KEY_TEST_ORDER=reverse` runs the pieces from last to first. A piece that fails only in reverse order depends on state from another piece.
- `SHADOW_SH` must name a script that runs `up|spawn|keys|down <name>` for a nested, invisible compositor session. It can also answer `status` with one `<name>: up|down ...` line per session, which the sweep reads.
  Cleanup of killed runs works only for drivers that keep a session's runtime dir in `/tmp/shadow-<uid>-<name>`.
  When `SHADOW_SH` is unset, the recipe uses `$HOME/dotfiles/.claude/skills/shadow/shadow.sh` if it is executable. With neither, it exits.
- Each run starts its own shadow session, so runs from different worktrees go in parallel with no lock.

## Areas and key-test-changed

Each piece exports `export const areas = ["hints", ...]`, the feature areas it exercises. Write it on one line: `areas.mjs` reads it as text, because importing a piece would load `harness.mjs`, which exits without `SHADOW_SH`. `areas.mjs` maps src paths to the same names, and a change runs the pieces that share an area with it.

| Area | Src it covers |
| --- | --- |
| `hints` | `content/hints`, hint, heading and page commands, image actions |
| `caret` | `content/caret` (except find), caret and visual commands |
| `find` | `content/caret/find_*`, the find command and workers |
| `whichkey` | `content/whichkey`, the key list, the which-key timer |
| `cmdline` | `cmdline/`, cmdline, history, bookmark and open-target commands, completion |
| `help` | `help/`, help, settings and native commands, the settings schema and docs |
| `newtab` | `newtab/` |
| `tabs` | tab and window code, tab, window, url, browser and open commands |
| `scroll` | scroll and align code, scroll and zoom commands |
| `config` | config reading, building and reload, themes, snippets, argument checks |
| `engines` | `shared/engines`, the engine command |
| `bundles` | lazy bundle loading |
| `keys` | the keymap compiler and merge, prefix tree, layers, repeat memory |
| `ui` | `content/ui`, toast, surface, mode indicator |

- The table in `areas.mjs` is `area_rules`. The first matching rule wins, so order matters.
- A rule with no areas (README files, icons, manifest, managed schema) selects nothing.
- The shared rule lists the key path and the command contract (for example `background/main.ts`, `shared/messages.ts`, `content/editable.ts`). A change to one of these files selects every area, so every piece runs.
- A src file that matches no rule fails `test/key/areas.test.ts`. Add its glob to `area_rules`. The same test fails when a piece has no `areas` or names an unknown area.
- A new piece needs its `areas` line. A new feature needs a name in `area_names`, a rule and the pieces that list it.
- Add `keys` to a piece that exercises how bindings compile, merge or match, not to every piece that presses keys.

`just key-test-changed [base] [head]` compares against `base` (default `origin/main`). It prints the changed area names and the chosen pieces first, then runs them through `KEY_TEST_PIECES`.

- With no `head`, the diff is the merge base with `HEAD` against the working tree, plus new files under `src`. With `head`, it is `base...head`.
- A shared file in the diff selects all pieces.
- Only `src/` paths count. With no src change it says so and runs nothing. A change to a piece file or to `areas.mjs` alone selects nothing, so name those pieces with `KEY_TEST_PIECES`.
- `node test/key/areas.mjs <base> [head]` prints the same choice without running anything.
- The full suite still runs once before a PR is ready.

## Piece lifecycle

`run_piece` in `harness.mjs` gives every piece the same start and the same cleanup, so a piece needs no state from the one before it.

- Before the piece: one window with one tab at `page?id=home_<piece>`, active and focused (the page reports `document.hasFocus()`), the config link on `config_dir`, no temp settings.
- After the piece, pass or fail: the `h.on_teardown` callbacks in reverse, every tab and window that was not in the start snapshot closed, the config link restored and reloaded, temp settings unset. A failed step is reported as a FAIL named `<piece> teardown` or `<piece> cleanup`. A failed reset skips the piece and reports `<piece> reset`.
- `h.setup(name, fn)` runs under any filter, is timed as `(setup)` and counts in no total. If it fails, the cases behind it fail with `setup failed`.
- `h.config_copy()` returns a private copy of the base config. Edit the copy and load it with `h.load_config_dir`. Never write `config_dir`.

## Timings

Every run times itself and prints a summary at the end: time by category, time outside cases, the 20 slowest cases and the open tab count. It also writes the full numbers as JSON.

- The file is `.logs/key-test-timings-<timestamp>.json` in the checkout. `KEY_TEST_TIMINGS_FILE=<path>` sets another path.
- Each moment of the run goes to one category: `keys` (a `shadow keys` call), `settle` (the pause after each key call), `sleeps` (other sleeps), `waits` (`wait_event`), `rdp` (debugger calls), `page_opens` (all of `open_page`, keys and waits inside it included), `driver` (`up`, `spawn`, `shot`) and `other` (everything untracked, such as test logic).
- The JSON holds `categories` and `outside_cases` (ms and call counts), `pieces` (wall time per piece file), `cases` (wall time and categories per case) and `tab_samples` (open tab count before and after each piece). Setup between cases counts as `(outside cases)`.
- The file is rewritten after each piece and when SIGINT or SIGTERM arrives, so a run killed at the time cap still leaves its numbers (the summary prints only at a normal end or on a signal).
- Piece files need no hooks: they get the timed `sleep`, `open_page`, `wait_event` and `rdp` from the case context (`context_for` in `harness.mjs`).

## Native host

`config.reload` reads the config through the native host, so each run installs it. `harness.mjs` runs `host/install.sh main` with `HOME` set to the session's throwaway HOME and a `curl` stand-in that copies the host from this checkout. It refuses the real HOME. It grants `nativeMessaging` from chrome code, because Firefox grants it only from a click. `launch_firefox.sh` sets `DESERTFOX_CONFIG_DIR` to a link in the run folder, and `load_config_dir` points that link at another folder before it presses `qr`. Managed storage still gives the config at startup.

## Traps

- Run key tests only in your own worktree. Never run two from one worktree: each `just key-test` rebuilds and clears that worktree's `dist/`.
- Do not wrap `just key-test` in `timeout`. The recipe already runs in a systemd scope with a memory cap of 8 GB, no swap and a time limit of 1800 seconds. Without a systemd user session it runs uncapped and says so.
- On the first run after a build, an early setup case can fail. Rerun once before you debug.
- Add-ons force-installed through the Firefox policy file can eat modifier chords in the shadow session. Disable them before you trust a chord result.
- The first-install Quick Start tab opens beside the first tab and shifts the tab order. That was the cause of #123: Alt+J wrapped to an empty tab instead of page a. The test config now sets `open_quick_start_on_install = false`, and `expect_exactly_one_visible` also checks the active tab URL, so an empty tab fails the case (#155).
- The sweep of leftover sessions stops only a session that carries the run's owner marker file, `desertfox-key-owner`, naming a dead run. A session with no marker is skipped, whatever its name, so cleanup never stops another tool's session. Keep that rule when you change cleanup code.
