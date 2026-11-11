# test/key

Key tests. Each run builds the extension, starts Firefox in its own nested, invisible session, sends real key presses and checks what the page and the background report. `session.mjs` starts the nested session, `keyboard.py` is its keyboard, `harness.mjs` holds the rest of a shard (`create_session`: Firefox, the page server, the helpers and `run_piece` with the piece lifecycle), `run.mjs` is the coordinator that splits the run across shards and prints the summary, `worker.mjs` runs one shard, `shards.mjs` orders the pieces by `piece_seconds.json` and tracks which shard holds which piece, `p<number>_*.mjs` are the pieces, `areas.mjs` maps src files to areas, `timings.mjs` measures where the time goes, `server.mjs` and `rdp.mjs` read the results (`rdp.mjs` is the debugger client: it queues requests per actor, treats untyped packets as replies and typed ones as events, follows the add-on's background page from the watcher's events, and also reads frames inside web pages; `rdp.test.ts` tests it against a fake debugger server), `launch_firefox.sh` starts Firefox, `stall_capture.mjs` records a Firefox stall (see Stall capture), and `user.js` and `config/` set up the test profile.

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

A full run takes about 34 s on 8 shards. It needs labwc, Hyprland, dbus-daemon and python3, and grim for the screenshot cases.

- `KEY_TEST_ONLY` runs only the cases whose name matches. It also runs the cases marked `{ setup: true }` and every `h.setup` step of a piece, which leave state that later cases read. The output tags those as `SETUP`.
- `KEY_TEST_PIECES` is a comma-separated list of piece names (the file name without `.mjs`). Only those pieces run, and an unknown name or an empty list aborts the run. Each piece must pass alone.
- `KEY_TEST_ORDER=reverse` runs the pieces from last to first, on one shard. A piece that fails only in reverse order depends on state from another piece.
- `KEY_TEST_SHARDS=<n>` sets the shard count (default 8, never more than the chosen pieces). See Shards.
- `KEY_TEST_DEADLINE_S=<s>` sets when the run stops itself (default 230). A full run on one shard takes longer, so it needs a higher value. The recipe sets the scope's time limit to this value plus 70 s, which covers the shutdown after the deadline.
- `KEY_TEST_WEIGHTS=<timings file>` orders the queue by that file instead of `piece_seconds.json` and the newest local timings.
- `KEY_TEST_RENDER_NODE=/dev/dri/renderD<n>` picks the render node of the host compositor. By default it is the first node whose driver is not NVIDIA.
- `KEY_TEST_PROBE=1 KEY_TEST_PIECES=p97_key_delivery KEY_TEST_DEADLINE_S=900 just key-test` runs the key-delivery probe. It presses every key the pieces use and checks each keydown's `key` and `code`, then counts lost F8 presses at 0, 30, 100 and 300 ms after a page loads. `KEY_TEST_PROBE_ROUNDS` sets the repeats (default 20). Without `KEY_TEST_PROBE` the piece does nothing.
- One run at a time per machine, across worktrees: the recipe takes `/tmp/desertfox-key-test.lock` and a second run waits up to 900 s for it, after it prints the holders. Never wrap `just key-test` in `flock` on that file: the outer lock blocks the recipe's own for the whole wait. `just test-all` runs `just test` beside the key test, and the unit tests take no extra lock.

## Stall capture

`KEY_TEST_STALL_CAPTURE=1` catches the rare stall where Firefox stops answering the debugger. It is off by default, and a normal run loads no gdb and pays nothing. With it on, each shard runs Firefox as a child of gdb (ptrace_scope 1 blocks attaching later). On the first "Firefox stopped answering the debugger" of a shard, before the teardown, it writes one file `stall-<session>-<ms>.txt` and prints its path. The file holds: whether a second debugger connection gets a greeting and answers, the /proc state (threads, wchan, CPU) of the parent and its descendants before and after that probe, and a gdb `thread apply all bt` of every parent thread, taken through SIGINT. The file sits in the run's `*-diagnostics/s<n>/` folder. gdb ends Firefox after the dump. If gdb is missing, the run prints one warning per worker and goes on without the capture.

```bash
KEY_TEST_STALL_CAPTURE=1 just key-test-flakes 30
```

Look for `stall capture written to` in the `run-<n>.log` files under `.logs/key-test-flakes-*/`. Firefox is slower under gdb, so compare flake rates only between runs that both have the capture on.

## Lifecycle probes

`just key-test-lifecycle [probe...]` runs `lifecycle_probe.mjs`: small real runs that are signalled, killed or crashed on purpose. The probes send SIGINT and SIGTERM to the whole process group and, in one probe, to the coordinator alone, at startup and mid-run. They also kill a worker, crash Firefox, hit the deadline, check the debug ports, run a foreign sweep, and SIGKILL a run before a rerun. Each probe checks the exit code, the output, the merged report's `incomplete` field, and that nothing stays in `/tmp` or running. The recipe takes the key-test lock, runs the probes one at a time and takes about 2 minutes. It stays out of `just test`. The `sigkill-coordinator-*` probes kill the coordinator alone, mid-case and while the sessions start. Its orphaned workers must stop their sessions and exit within 3 s, and a rerun's sweep must wait for them before it removes their run folder.

## Session and keyboard

`session.mjs` starts one session per shard: a private session bus, headless labwc as the host and Hyprland nested in it. The session has no bar and no notification server, so `user.js` sets `alerts.useSystemBackend` to false and Firefox shows notices in a window of its own. Close a notice when the case is done, because its window holds the focus.

- Each session lives in `/tmp/dfk-<uid>-<name>`: its bus, its Wayland sockets and an `owner` file with the pid of the worker that started it. Every process of the session carries that dir in its environment. `stop()` and the sweep find the processes by it, so a daemon the bus started goes too.
- The start takes about 1 s. The stop ends Firefox and the keyboard first, then the rest, with SIGKILL after 2 s each.
- `keyboard.py` is the one keyboard of the session. It uploads the US keymap in `us.xkb` once, so every key arrives with its real `code`, and capitals and symbols press a real Shift. `press_keys` takes wtype-style args (`-k`, `-M`, `-m`, `-P`, `-p`, `-d`, `-s`, ASCII text). An unknown key fails the call by name, and a dead compositor fails every later call with the client's exit message.
- The client sends keys as fast as the compositor takes them, with no pause between keys. A case that types text waits for it to take effect before the key that acts on it (`type_in_line`, see Waits).
- `us.xkb` is the output of `xkbcli compile-keymap --layout us`, committed so a run needs no xkbcli.

## Areas and key-test-changed

Each piece exports `export const areas = ["hints", ...]`, the feature areas it exercises. Write it on one line: `areas.mjs` reads it as text, so the selection loads no piece and no harness. `areas.mjs` maps src paths to the same names, and a change runs the pieces that share an area with it.

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
| `toolbar` | `popup/`, `background/toolbar.ts`, the on/off switch and the toolbar shortcut |
| `media` | `content/media`, the media command and its frame fan-out |

- The table in `areas.mjs` is `area_rules`. The first matching rule wins, so order matters.
- A rule with no areas (README files, icons) selects nothing.
- The shared rule lists the key path and the command contract (for example `background/main.ts`, `shared/messages.ts`, `content/editable.ts`, and `manifest.json`). A change to one of these files selects every area, so every piece runs.
- A src file that matches no rule fails `test/key/areas.test.ts`. Add its glob to `area_rules`. The same test fails when a piece has no `areas` or names an unknown area.
- A new piece needs its `areas` line. A new feature needs a name in `area_names`, a rule and the pieces that list it.
- Add `keys` to a piece that exercises how bindings compile, merge or match, not to every piece that presses keys.

`just key-test-changed [base] [head]` compares against `base` (default `origin/main`). It prints the changed area names and the chosen pieces first, then runs them through `KEY_TEST_PIECES`.

- With no `head`, the diff is the merge base with `HEAD` against the working tree, plus new files under `src`, `test/key` and `tools`. With `head`, it is `base...head`.
- A shared file in the diff selects all pieces.
- A changed piece file selects that piece. A change to the test machinery (`harness.mjs`, `run.mjs`, `server.mjs`, `rdp.mjs`, `session.mjs`, `keyboard.py`, `us.xkb`, `timings.mjs`, `areas.mjs`, `launch_firefox.sh`, `user.js`, `config/`) or to `tools/build.mjs` or a tools file it imports (`write_commands_json.mjs`, `render_docs.ts`) selects every piece. Other paths are ignored.
- With no src, piece or harness change it says so and runs nothing.
- Renames count both paths, so a moved file selects the areas of its old path too.
- `node test/key/areas.mjs <base> [head]` prints the same choice without running anything.
- The full suite still runs once before a PR is ready.

## Shards

`run.mjs` forks one `worker.mjs` per shard. Each worker owns one `create_session`: its own session (named `ok` plus the worker pid in base 36), Firefox profile, page server and keyboard. The workers take pieces from one queue until it is empty, so a fast shard takes more pieces.

- The queue runs the longest piece first and a piece with no weight before all others. The weights come from `piece_seconds.json`, overridden piece by piece by the newest `.logs/key-test-timings-*.json` of this checkout when that file is newer. `just key-test-weights` rewrites `piece_seconds.json` from a full run. A piece that runs more than twice its weight, or 10 s over it, prints a `stale weight` line.
- With one shard the queue keeps the given order. Each shard's sequence prints at the end (`s3 sequence: ...`), so `KEY_TEST_SHARDS=1 KEY_TEST_PIECES=<that list>` replays a failure that showed in one shard.
- The coordinator picks a distinct debug port for each worker, below the kernel's ephemeral port range, so no page server or other worker can draw it. The workers start 300 ms apart.
- The coordinator sweeps leftover sessions and run folders once before it forks. Workers never sweep, so no worker stops another worker's live session.
- Each output line carries its shard (`[s3] PASS ...`). The end of the run lists the failed cases by piece.
- A failed piece is not retried. A worker that dies fails its running piece, and the other workers take the rest of the queue. A worker whose debugger connection closes (Firefox crashed or exited) takes no more pieces.
- At the deadline, or on SIGINT or SIGTERM, the coordinator sends SIGTERM to every worker. Each worker writes its timings and stops its session. A worker still alive after 10 s is killed, and the coordinator stops its session. The run then writes the merged timings and exits.
- Each worker's session files sit under a run folder in `/tmp` (`desertfox-key-run-*`), which the coordinator removes at the end. Its `owner` file holds the coordinator's pid and start time. A killed coordinator leaves the folder behind, and the next run's sweep removes it once that pid is gone or belongs to a newer process. A folder with no owner file is skipped.
- Exit codes: 0 when every chosen piece ran and passed, 1 for a failed case, a piece that never finished, a dead worker or the deadline, 2 for a setup error (a bad `KEY_TEST_PIECES`, `KEY_TEST_SHARDS` or `KEY_TEST_DEADLINE_S`), 130 or 143 after SIGINT or SIGTERM.

## Piece lifecycle

`run_piece` in `harness.mjs` gives every piece the same start and the same cleanup, so a piece needs no state from the one before it.

- Before the piece: one window with one tab at `page?id=home_<piece>`, active and focused (the page reports `document.hasFocus()`) and taking keys (it reported the key probe), the config link on `config_dir`, no temp settings.
- After the piece, pass or fail: the `h.on_teardown` callbacks in reverse, every tab and window that was not in the start snapshot closed, the config link restored and reloaded, temp settings unset. The page is refocused only when one of those two steps has work, and never on an about: or extension page. A failed step is reported as a FAIL named `<piece> teardown` or `<piece> cleanup`. A failed reset skips the piece and reports `<piece> reset`.
- `h.setup(name, fn)` runs under any filter, is timed as `(setup)` and counts in no total. If it fails, the cases behind it fail with `setup failed`.
- `h.config_copy()` returns a private copy of the base config. Edit the copy and load it with `h.load_config_dir`. Never write `config_dir`.

## Waits

A converted piece presses keys with `press_keys` (no settle) and waits for the effect of each key before the next press. `send_keys` keeps its 350 ms settle for pieces not converted yet.

- `wait_event(mark, predicate, what, timeout_ms)`, `poll_until(what, check, { timeout_ms, step_ms, expected_timeout })` and `wait_cmdline(check, what, timeout_ms, { expected_timeout })` fail by name when the effect never comes. `wait_event` wakes on each report the page server takes, so it answers within a millisecond of the report. `poll_until` and `wait_cmdline` read over the debugger every `step_ms` (50 ms). A case that still runs after 30 s fails with the wait it was in. The body cannot be cancelled, so its late failure is only logged.
- `read_cmdline_state()` reads the command line (value, caret, focus, rows, flags, marks, note) from the selected tab. The line is an extension iframe in the page, which `getViews` and the add-on's own debugger watcher do not list. So `evaluate_in_page_frames` in `rdp.mjs` finds the frame in the parent process and reads it in the content process that holds it. It returns `{ open: false }` when no line is open. `close_cmdline()` presses Escape until the line is gone.
- Type into the line with `type_in_line(text, { until })`, never in the same call as the key that acts on the text. It waits until the line holds the focus, types at the caret and waits until the line holds the text, plus `until` on the same state (for example the rows a tab list fills in after the text). A key that comes while the focus moves into or out of the line's frame is lost at full speed, and an action key that comes before the text took effect acts on part of it.
- `run_line(text)` opens the line with `:` (`open_cmdline`), types the command with `type_in_line` and presses Enter. `complete_in_line()` presses Tab and waits for the previewed row or the taken match. `type_in_address_bar(text)` does the same as `type_in_line` for Firefox's address bar, read from chrome code.
- `p1_cmdline.mjs` keeps one case that types `:`, a command and Enter in one call, because it tests that no key typed during the line's load is lost.
- `barrier(page_id)` presses F8, which nothing binds, and waits for the page's `keydown` report of it. Every earlier key has reached the page by then. It fails when the key shows on another page, never shows (a mode that swallows keys) or the line is open (the key would type into it).
- `expect_absent(mark, page_id, predicate, what)` runs a barrier and fails when a matching event came before it. A key that was lost also leaves nothing, so pair it with a proof that the key arrived (a line value, a badge). A scroll is reported 150 ms after it ends, so pass `report_delay_ms: scroll_report_wait_ms`.
- `settle_focus({ tab_id })` waits until a test page reports focus, then runs the key probe on it. Use it after keys that switch or close a tab. It cannot serve an extension page.
- The key probe (`wait_takes_keys(page_id)`) presses F4 until the page reports it, again every 200 ms for up to 3 s. The probe has its own key, apart from the barrier key F8, so a late probe report matches no barrier and the probe needs no wait for it. A page drops every key of its first moments (a key 30 ms after `tree_read` was lost every time, one at 100 ms never) and a key pressed right after it reports focus. A probe press can come after the case's mark, so a case that counts keydown reports skips F4. The page `s` that cancels keys in capture still reports each keydown, so the probe works there too.
- `open_page` goes through the background (`tabs.create` or `tabs.update`), waits for `tree_read` and focus, then runs the key probe. `open_page_by_keys` is the address bar way for a case that tests the bar.
- `expect_no_scroll(mark, page_id)` is a barrier plus the scroll report delay. It works on any page that reports F8, ignore mode included.
- `wait_active_tab(page_id_or_check, what)` polls the background until the active tab holds that page, and returns its page id. A tab hidden and shown again within about 300 ms of its last switch sends no visibility report, so no case waits on a visibility report for a tab switch.
- `tab_switch_mark()` and `tabs_shown_since(switch_mark)` read a log of tab activations that a listener in the background keeps. A case that checks that a key switched only once reads it, and `expect_no_tab_shown(switch_mark, what)` fails when any tab came to the front.
- `expect_exactly_one_visible(switch_mark, page_id)` waits for the page to be the active tab, settles the switch, runs a barrier on it and then reads the active tab and the switches since `switch_mark` from the background. A destination that cancels keys in capture (`p0_core_keys.mjs` page `s`) takes `{ destination_cancels_keys: true }` and sits out 1.5 s instead.
- `scroll_delta_by_press(page_id, keys)` is `scroll_delta_after` with no settle.
- `hint_label_count()` counts the hint labels in the active tab, so a case waits for labels before it types a label and for zero after Escape. Hint mode has no mode badge.
- `in_active_tab(code)` runs code in the active tab's content script world and returns its first result. It throws on a script error, so a poll that calls it fails at once and does not poll again.
- `escape_to_normal(page_id)` presses Escape until the mode badge reads NORMAL, at most three times, and waits for the badge after each press.
- `press_and_wait_for_move(page_id, keys, what)` presses a caret key and waits for the selection report. `badge_is(page_id, label)` and `is_selection_of(page_id)` are the matching event predicates.
- `which_key_delay_ms` is the delay from `config/settings.toml` (100 ms). A check that no panel shows sits out `which_key_delay_ms` plus a margin. The toast life (3 s) is a constant in `src/`, so the test config cannot shorten it.
- A window_focus report from a frame comes before the frame takes keys, so `p6_frames.mjs` runs the key probe on the frame instead.

## Timings

Every run times itself and prints a summary at the end: time by category, time outside cases, the 20 slowest cases and the open tab count. It also writes the full numbers as JSON.

- The file is `.logs/key-test-timings-<timestamp>.json` in the checkout. `KEY_TEST_TIMINGS_FILE=<path>` sets another path. Each worker writes its own file in the run folder, and the coordinator merges them into this one.
- Each moment of the run goes to one category: `keys` (a call to the keyboard client), `settle` (the pause after each key call), `sleeps` (other sleeps), `waits` (`wait_event`, `poll_until`), `rdp` (debugger calls and the pauses between result polls), `page_opens` (all of `open_page`, keys and waits inside it included), `driver` (the session start and screenshots) and `other` (everything untracked, such as test logic).
- The JSON holds `categories` and `outside_cases` (ms and call counts), `pieces` (wall time per piece file), `cases` (wall time and categories per case) and `tab_samples` (open tab count before and after each piece). Setup between cases counts as `(outside cases)`.
- `total_ms` is the coordinator's wall time. The case and category figures add up across shards, so they exceed it. Each `pieces`, `cases` and `tab_samples` entry carries its `shard`.
- `shards` holds one entry per shard: `name`, `startup_ms` (run time when it was ready), `busy_ms` (time in pieces), `idle_ms` (time it sat finished while others ran), `finished_ms`, its `pieces` in order and its `exit`. `critical_shard` is the shard that finished last.
- A `KEY_TEST_ONLY` run records its regex as `filter`. Its pieces skip cases, so neither the weights load nor `just key-test-weights` uses the file.
- A piece that a signal cut short has an entry with `in_flight: true`. A run that did not finish has `incomplete: { reason, in_flight, not_started }`. The coordinator's own record of which shard holds which piece fills it, so it names the piece of a worker that was killed outright.
- A failed shard keeps Firefox's output (`spawn.log` of the session) and any crash dumps in `.logs/key-test-timings-<timestamp>-diagnostics/s<n>/`, because its teardown deletes them. When the debugger connection closes, every case that fails after it names the lost connection, so a crash reads differently from a hang.
- `lost_key_suspects` lists each wait that timed out after a key press, with its case, and the summary prints the count. A clean run has none. A suspect is a lost key or an effect that never came. A probe whose timeout is the normal path passes `expected_timeout: true` to `poll_until` and is not counted.
- Piece files need no hooks: they get the timed `sleep`, `open_page`, `wait_event` and `rdp` from the case context (`context_for` in `harness.mjs`).

## Firefox internals

The key tests reach into five Firefox internals: `ExtensionPageChild.sys.mjs`, the window path to the selected tab's browsing context, `ExtensionSettingsStore`, `ExtensionPermissions` with `WebExtensionPolicy`, and `gURLBar`. After setup each shard runs one chrome check of all five (`firefox_internals.mjs`, about 20 to 50 ms). A broken one fails the shard with `Firefox internal broken: <name> (Firefox <version>, build <id>)`. The version and build ID come from `Services.appinfo` and go into the `firefox` field of the timings report and the summary. A late command-line read error also carries the version. No list of known-good versions exists, so an update that breaks nothing fails nothing. After a Firefox update that trips a check, fix the call site named in the message, then the check.

## Native host

`config.reload` reads the config through the native host, so each run installs it. `harness.mjs` runs `host/install.sh main` with `HOME` set to the session's throwaway HOME and a `curl` stand-in that copies the host from this checkout. It refuses the real HOME. It grants `nativeMessaging`, `browsingData` and `cookies` from chrome code, because Firefox grants an optional permission only from a click. `set_optional_permissions(action, permissions)` grants or removes them again for a case that tests the missing-permission path. `launch_firefox.sh` sets `DESERTFOX_CONFIG_DIR` to a link in the run folder, and `load_config_dir` points that link at another folder before it presses `,r`. The harness writes no managed storage file, so a new profile starts on the defaults (`source: defaults`). Setup waits up to 5 s for the first-install Quick Start tab, which the defaults open, and closes it. The first piece reset calls `load_config_dir(config_dir)` once, after the home tab passes the key probe, and waits for `source: files`. Setup code that runs before that reset sees no snippets, engines or test config.

## Traps

- Run key tests only in your own worktree. Never run two from one worktree: each `just key-test` rebuilds and clears that worktree's `dist/`.
- Do not wrap `just key-test` in `timeout`. The recipe already runs in a systemd scope with a memory cap of 16 GB (throttled from 14 GB), no swap and CPU limited to 14 cores, and a time limit of the deadline plus 70 seconds (300 by default). Without a systemd user session it runs uncapped and says so.
- On the first run after a build, an early setup case can fail. Rerun once before you debug.
- Add-ons force-installed through the Firefox policy file can eat modifier chords in the nested session. Disable them before you trust a chord result.
- The first-install Quick Start tab opens beside the first tab and shifts the tab order. That was the cause of #123: Alt+J wrapped to an empty tab instead of page a. The harness now closes that tab during setup, and `expect_exactly_one_visible` also checks the active tab URL, so an empty tab fails the case (#155).
- The sweep of leftover sessions stops only a session whose `owner` file names a dead run. A session dir with no owner file is skipped, so cleanup never stops another tool's session. Keep that rule when you change cleanup code.

## Flake rate

`just key-test-flakes [n=10]` runs `just key-test` n times, one after the other, and keeps each run's merged report and log in `.logs/key-test-flakes-<timestamp>/`. It first sweeps leftover `/tmp/desertfox-key-run-*` folders with the sweeps of `session.mjs`. `flakes.mjs` then folds the reports into one JSON line and appends it to `~/.local/state/desertfox/key-test-flakes.jsonl` (`KEY_TEST_FLAKES_HISTORY=<path>` sets another file).

- The line holds `at`, `commit`, `runs`, `clean_runs`, `run_errors`, `too_thin` and `cases`: each failing case with its `fail` run count and its `suspects` (lost-key suspects) count.
- A run error is a run with no report: the lock wait of 900 s ran out or the run died early. A batch with fewer than half its runs completed is marked `too_thin`.
- The merged report of every run carries `failed_cases`, `failures` and `exit_code` for this.
- When a case fails in 2 or more runs, or 3 or more runs error, the batch sends a `notify-send` alert and exits 1.
- Run it on demand, when you suspect a flaky test. The batch tests the checkout as it is, with its current branch and uncommitted changes, so the `commit` of a line can name a dirty tree. The alert thresholds are absolute and assume n near 10.
