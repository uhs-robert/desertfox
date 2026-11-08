# test/key

Key tests. Each run builds the extension, starts Firefox in its own nested, invisible session, sends real key presses and checks what the page and the background report. `harness.mjs` holds the session (`create_session`: Firefox, the page server, the helpers and `run_piece` with the piece lifecycle), `run.mjs` is the coordinator that splits the run across shards and prints the summary, `worker.mjs` runs one shard, `shards.mjs` orders the pieces by `piece_seconds.json` and tracks which shard holds which piece, `p<number>_*.mjs` are the pieces, `areas.mjs` maps src files to areas, `timings.mjs` measures where the time goes, `server.mjs` and `rdp.mjs` read the results (`rdp.mjs` also reads frames inside web pages), `launch_firefox.sh` starts Firefox, and `user.js` and `config/` set up the test profile.

## Run

```bash
just key-test
KEY_TEST_ONLY=<regex> just key-test
KEY_TEST_PIECES=p7_caret,p11_find just key-test
KEY_TEST_ORDER=reverse just key-test
KEY_TEST_SHARDS=1 KEY_TEST_DEADLINE_S=900 just key-test  # serial
just key-test-changed [base] [head]
just key-test-weights [timings file]
```

A full run takes about 1 minute on 6 shards and needs a nested Hyprland.

- `KEY_TEST_ONLY` runs only the cases whose name matches. It also runs the cases marked `{ setup: true }` and every `h.setup` step of a piece, which leave state that later cases read. The output tags those as `SETUP`.
- `KEY_TEST_PIECES` is a comma-separated list of piece names (the file name without `.mjs`). Only those pieces run, and an unknown name or an empty list aborts the run. Each piece must pass alone.
- `KEY_TEST_ORDER=reverse` runs the pieces from last to first, on one shard. A piece that fails only in reverse order depends on state from another piece.
- `KEY_TEST_SHARDS=<n>` sets the shard count (default 6, never more than the chosen pieces). See Shards.
- `KEY_TEST_DEADLINE_S=<s>` sets when the run stops itself (default 280). A full run on one shard takes longer, so it needs a higher value. The recipe sets the scope's time limit to this value plus 70 s, which covers the shutdown after the deadline.
- `KEY_TEST_WEIGHTS=<timings file>` orders the queue by that file instead of `piece_seconds.json` and the newest local timings.
- `SHADOW_SH` must name a script that runs `up|spawn|keys|down <name>` for a nested, invisible compositor session. It can also answer `status` with one `<name>: up|down ...` line per session, which the sweep reads.
  Cleanup of killed runs works only for drivers that keep a session's runtime dir in `/tmp/shadow-<uid>-<name>`.
  When `SHADOW_SH` is unset, the recipe uses `$HOME/dotfiles/.claude/skills/shadow/shadow.sh` if it is executable. With neither, it exits.
- One run at a time per machine, across worktrees: the recipe takes `/tmp/desertfox-key-test.lock` and a second run waits up to 900 s for it, after it prints the holders. Never wrap `just key-test` in `flock` on that file: the outer lock blocks the recipe's own for the whole wait.

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
- A rule with no areas (README files, icons) selects nothing. `managed_schema.json` maps to `help` and `config`.
- The shared rule lists the key path and the command contract (for example `background/main.ts`, `shared/messages.ts`, `content/editable.ts`, and `manifest.json`). A change to one of these files selects every area, so every piece runs.
- A src file that matches no rule fails `test/key/areas.test.ts`. Add its glob to `area_rules`. The same test fails when a piece has no `areas` or names an unknown area.
- A new piece needs its `areas` line. A new feature needs a name in `area_names`, a rule and the pieces that list it.
- Add `keys` to a piece that exercises how bindings compile, merge or match, not to every piece that presses keys.

`just key-test-changed [base] [head]` compares against `base` (default `origin/main`). It prints the changed area names and the chosen pieces first, then runs them through `KEY_TEST_PIECES`.

- With no `head`, the diff is the merge base with `HEAD` against the working tree, plus new files under `src`, `test/key` and `tools`. With `head`, it is `base...head`.
- A shared file in the diff selects all pieces.
- A changed piece file selects that piece. A change to the test machinery (`harness.mjs`, `run.mjs`, `server.mjs`, `rdp.mjs`, `timings.mjs`, `areas.mjs`, `launch_firefox.sh`, `user.js`, `config/`) or to `tools/build.mjs` or a tools file it imports (`write_commands_json.mjs`, `render_docs.ts`) selects every piece. Other paths are ignored.
- With no src, piece or harness change it says so and runs nothing.
- Renames count both paths, so a moved file selects the areas of its old path too.
- `node test/key/areas.mjs <base> [head]` prints the same choice without running anything.
- The full suite still runs once before a PR is ready.

## Shards

`run.mjs` forks one `worker.mjs` per shard. Each worker owns one `create_session`: its own shadow session (named `ok` plus the worker pid in base 36), Firefox profile, page server and keyboard. The workers take pieces from one queue until it is empty, so a fast shard takes more pieces.

- The queue runs the longest piece first and a piece with no weight before all others. The weights come from `piece_seconds.json`, overridden piece by piece by the newest `.logs/key-test-timings-*.json` of this checkout when that file is newer. `just key-test-weights` rewrites `piece_seconds.json` from a full run. A piece that runs more than twice its weight, or 10 s over it, prints a `stale weight` line.
- With one shard the queue keeps the given order. Each shard's sequence prints at the end (`s3 sequence: ...`), so `KEY_TEST_SHARDS=1 KEY_TEST_PIECES=<that list>` replays a failure that showed in one shard.
- The coordinator picks a distinct debug port for each worker, below the kernel's ephemeral port range, so no page server or other worker can draw it. The workers start 300 ms apart.
- The coordinator sweeps leftover sessions once before it forks. Workers never sweep, so no worker stops another worker's live session.
- Each output line carries its shard (`[s3] PASS ...`). The end of the run lists the failed cases by piece.
- A failed piece is not retried. A worker that dies fails its running piece, and the other workers take the rest of the queue. A worker whose debugger connection closes (Firefox crashed or exited) takes no more pieces.
- At the deadline, or on SIGINT or SIGTERM, the coordinator sends SIGTERM to every worker. Each worker writes its timings and stops its session. A worker still alive after 10 s is killed, and the coordinator stops its session. The run then writes the merged timings and exits.
- Each worker's session files sit under a run folder in `/tmp`, which the coordinator removes at the end.
- Exit codes: 0 when every chosen piece ran and passed, 1 for a failed case, a piece that never finished, a dead worker or the deadline, 2 for a setup error (no `SHADOW_SH`, a bad `KEY_TEST_PIECES`, `KEY_TEST_SHARDS` or `KEY_TEST_DEADLINE_S`), 130 or 143 after SIGINT or SIGTERM.

## Piece lifecycle

`run_piece` in `harness.mjs` gives every piece the same start and the same cleanup, so a piece needs no state from the one before it.

- Before the piece: one window with one tab at `page?id=home_<piece>`, active and focused (the page reports `document.hasFocus()`) and at least 300 ms old, the config link on `config_dir`, no temp settings.
- After the piece, pass or fail: the `h.on_teardown` callbacks in reverse, every tab and window that was not in the start snapshot closed, the config link restored and reloaded, temp settings unset. The page is refocused only when one of those two steps has work, and never on an about: or extension page. A failed step is reported as a FAIL named `<piece> teardown` or `<piece> cleanup`. A failed reset skips the piece and reports `<piece> reset`.
- `h.setup(name, fn)` runs under any filter, is timed as `(setup)` and counts in no total. If it fails, the cases behind it fail with `setup failed`.
- `h.config_copy()` returns a private copy of the base config. Edit the copy and load it with `h.load_config_dir`. Never write `config_dir`.

## Waits

A converted piece presses keys with `press_keys` (no settle) and waits for the effect of each key before the next press. `send_keys` keeps its 350 ms settle for pieces not converted yet.

- `wait_event`, `poll_until(what, check, { timeout_ms, step_ms })` and `wait_cmdline(check, what)` fail by name when the effect never comes. A case that still runs after 30 s fails with the wait it was in. The body cannot be cancelled, so its late failure is only logged.
- `read_cmdline_state()` reads the command line (value, caret, focus, rows, flags, marks, note) from the selected tab. The line is an extension iframe in the page, which `getViews` and the add-on's own debugger watcher do not list. So `evaluate_in_page_frames` in `rdp.mjs` finds the frame in the parent process and reads it in the content process that holds it. It returns `{ open: false }` when no line is open. `close_cmdline()` presses Escape until the line is gone.
- `barrier(page_id)` presses F8, which nothing binds, and waits for the page's `keydown` report of it. Every earlier key has reached the page by then. It fails when the key shows on another page, never shows (a page that cancels keys in capture, a mode that swallows keys) or the line is open (the key would type into it).
- `expect_absent(mark, page_id, predicate, what)` runs a barrier and fails when a matching event came before it. A key that was lost also leaves nothing, so pair it with a proof that the key arrived (a line value, a badge). A scroll is reported 150 ms after it ends, so pass `report_delay_ms: scroll_report_wait_ms`.
- `settle_focus({ tab_id })` waits until a test page reports focus, then 100 ms. Use it after keys that switch or close a tab. It cannot serve an extension page.
- `open_page` goes through the background (`tabs.create` or `tabs.update`), waits for `tree_read` and focus, and returns no sooner than 300 ms after the open. A key pressed within about 30 ms of an open was lost every time, and a tab switched within about 150 ms lost the report of its next visibility change. `open_page_by_keys` is the address bar way for a case that tests the bar.
- `expect_no_scroll(mark, page_id)` is a barrier plus the scroll report delay. It works on any page that reports F8, ignore mode included.
- `expect_exactly_one_visible(mark, page_id)` waits for the page to show, settles the switch, runs a barrier on it and then reads the active tab from the background. A destination that cancels keys in capture (`p0_core_keys.mjs` page `s`) never reports F8, so the call takes `{ destination_cancels_keys: true }` and sits out 1.5 s.
- `settle_tab_switch()` is `settle_focus` plus 250 ms. A tab that is hidden and shown again within about 250 ms loses its visibility reports, so a key that switches tab again waits this long. Slice 7 should remove it with the other floors.
- `scroll_delta_by_press(page_id, keys)` is `scroll_delta_after` with no settle.
- `hint_label_count()` counts the hint labels in the active tab, so a case waits for labels before it types a label and for zero after Escape. Hint mode has no mode badge.
- `in_active_tab(code)` runs code in the active tab's content script world and returns its first result. It throws on a script error, so a poll that calls it fails at once and does not poll again.
- `escape_to_normal(page_id)` presses Escape until the mode badge reads NORMAL, at most three times, and waits for the badge after each press.
- `press_and_wait_for_move(page_id, keys, what)` presses a caret key and waits for the selection report. `badge_is(page_id, label)` and `is_selection_of(page_id)` are the matching event predicates.
- `which_key_delay_ms` is the delay from `config/settings.toml` (100 ms). A check that no panel shows sits out `which_key_delay_ms` plus a margin. The toast life (3 s) is a constant in `src/`, so the test config cannot shorten it.
- A window_focus report from a frame comes before the frame takes keys, so `p6_frames.mjs` keeps two 300 ms sleeps.

## Timings

Every run times itself and prints a summary at the end: time by category, time outside cases, the 20 slowest cases and the open tab count. It also writes the full numbers as JSON.

- The file is `.logs/key-test-timings-<timestamp>.json` in the checkout. `KEY_TEST_TIMINGS_FILE=<path>` sets another path. Each worker writes its own file in the run folder, and the coordinator merges them into this one.
- Each moment of the run goes to one category: `keys` (a `shadow keys` call), `settle` (the pause after each key call), `sleeps` (other sleeps), `waits` (`wait_event`, `poll_until`), `rdp` (debugger calls and the pauses between result polls), `page_opens` (all of `open_page`, keys and waits inside it included), `driver` (`up`, `spawn`, `shot`) and `other` (everything untracked, such as test logic).
- The JSON holds `categories` and `outside_cases` (ms and call counts), `pieces` (wall time per piece file), `cases` (wall time and categories per case) and `tab_samples` (open tab count before and after each piece). Setup between cases counts as `(outside cases)`.
- `total_ms` is the coordinator's wall time. The case and category figures add up across shards, so they exceed it. Each `pieces`, `cases` and `tab_samples` entry carries its `shard`.
- `shards` holds one entry per shard: `name`, `startup_ms` (run time when it was ready), `busy_ms` (time in pieces), `idle_ms` (time it sat finished while others ran), `finished_ms`, its `pieces` in order and its `exit`. `critical_shard` is the shard that finished last.
- A `KEY_TEST_ONLY` run records its regex as `filter`. Its pieces skip cases, so neither the weights load nor `just key-test-weights` uses the file.
- A piece that a signal cut short has an entry with `in_flight: true`. A run that did not finish has `incomplete: { reason, in_flight, not_started }`. The coordinator's own record of which shard holds which piece fills it, so it names the piece of a worker that was killed outright.
- A failed shard keeps Firefox's output (`spawn.log` of the shadow session) and any crash dumps in `.logs/key-test-timings-<timestamp>-diagnostics/s<n>/`, because its teardown deletes them. When the debugger connection closes, every case that fails after it names the lost connection, so a crash reads differently from a hang.
- Piece files need no hooks: they get the timed `sleep`, `open_page`, `wait_event` and `rdp` from the case context (`context_for` in `harness.mjs`).

## Native host

`config.reload` reads the config through the native host, so each run installs it. `harness.mjs` runs `host/install.sh main` with `HOME` set to the session's throwaway HOME and a `curl` stand-in that copies the host from this checkout. It refuses the real HOME. It grants `nativeMessaging` from chrome code, because Firefox grants it only from a click. `launch_firefox.sh` sets `DESERTFOX_CONFIG_DIR` to a link in the run folder, and `load_config_dir` points that link at another folder before it presses `qr`. Managed storage still gives the config at startup.

## Traps

- Run key tests only in your own worktree. Never run two from one worktree: each `just key-test` rebuilds and clears that worktree's `dist/`.
- Do not wrap `just key-test` in `timeout`. The recipe already runs in a systemd scope with a memory cap of 16 GB (throttled from 14 GB), no swap and CPU limited to 14 cores, and a time limit of the deadline plus 70 seconds (350 by default). Without a systemd user session it runs uncapped and says so.
- On the first run after a build, an early setup case can fail. Rerun once before you debug.
- Add-ons force-installed through the Firefox policy file can eat modifier chords in the shadow session. Disable them before you trust a chord result.
- The first-install Quick Start tab opens beside the first tab and shifts the tab order. That was the cause of #123: Alt+J wrapped to an empty tab instead of page a. The test config now sets `open_quick_start_on_install = false`, and `expect_exactly_one_visible` also checks the active tab URL, so an empty tab fails the case (#155).
- The sweep of leftover sessions stops only a session that carries the run's owner marker file, `desertfox-key-owner`, naming a dead run. A session with no marker is skipped, whatever its name, so cleanup never stops another tool's session. Keep that rule when you change cleanup code.
