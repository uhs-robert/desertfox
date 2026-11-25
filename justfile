default:
    @just --list

# Regenerate the binding tables in docs/keymap.md from the default keymap and the site row tables in docs/site_rows.md from the default site rows.
docs-gen: install_deps
    npm run --silent docs:gen

# Regenerate src/shared/themes.ts from themes/oasis/*.css and themes/*.toml, and the theme names in src/shared/setting_completion.ts.
themes: install_deps
    npm run --silent themes:write
    npm run --silent completion:write

# Regenerate src/shared/default_settings.ts from the defaults in src/shared/settings_table.ts, and src/shared/setting_completion.ts from the setting rules.
settings-defaults: install_deps
    npm run --silent defaults:write
    npm run --silent completion:write

# Copy the Oasis theme CSS files from an oasis.nvim checkout into themes/oasis/, then regenerate src/shared/themes.ts and src/shared/setting_completion.ts.
oasis-themes oasis_nvim_dir: install_deps
    npm run --silent themes:copy -- {{quote(oasis_nvim_dir)}}
    npm run --silent themes:write
    npm run --silent completion:write

# Benchmark DesertFox against the store builds of rival extensions in headless Firefox, and write tables to $MEASURE_DIR/rivals/out. Needs firefox, unzip and network. See tools/measure/README.md.
measure-rivals: build-key-test
    node tools/measure/rivals/rivals.mjs

# Typecheck and bundle the extension into dist/.
build: install_deps
    npm run --silent build

# The build the key test loads, in dist-key-test/. It differs from dist/ only by the page-readable test attributes (src/shared/key_test_build.ts). Run it after `build`, which does the typecheck.
build-key-test: install_deps
    KEY_TEST_BUILD=1 node tools/build.mjs

# Check docs/keymap.md, docs/site_rows.md, src/shared/themes.ts, src/shared/default_settings.ts and src/shared/setting_completion.ts are current, lint for floating and misused promises, then run the unit tests from TypeScript source by Node's type stripping, and the Python host tests. `just test-all` runs this beside `just key-test`.
test: install_deps
    #!/usr/bin/env bash
    set -euo pipefail
    # Each run owns one scratch dir, so a concurrent run in another session is never touched. It becomes TMPDIR for every test process. A run killed by SIGKILL skips the trap below, so the sweep removes such dirs once they are older than the longest normal run (the scope limit of 900 s, plus margin).
    scratch_parent="${TMPDIR:-/tmp}"
    find "$scratch_parent" -maxdepth 1 -type d -name 'desertfox-test-run.*' -mmin +30 -exec rm -rf {} + 2>/dev/null || true
    run_dir=$(mktemp -d "$scratch_parent/desertfox-test-run.XXXXXX")
    trap 'rm -rf "$run_dir"' EXIT
    export TMPDIR="$run_dir"
    # Node keeps its module compile cache in TMPDIR by default, which the guard would read as a leak. A stable dir outside the run dir keeps the cache.
    export NODE_COMPILE_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/desertfox/node-compile-cache"
    # A test that runs away dies with its scope, so nothing outlives the run. The host tests share the scope and its time limit.
    all_tests='just host-test && npm run --silent test'
    # Inside agents.slice, keep the scope there too: a bare scope lands in app.slice and escapes the slice CPU cap.
    slice_args=(); if grep -q /agents.slice/ /proc/self/cgroup 2>/dev/null; then slice_args=(--slice=agents.slice); fi
    # Not exec: exec would skip the trap and leave the run dir behind.
    status=0
    if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 true >/dev/null 2>&1; then
        systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 bash -c "$all_tests" || status=$?
    else
        echo "test: no systemd user session, so this run has no memory cap or time limit." >&2
        bash -c "$all_tests" || status=$?
    fi
    # Every test removes its own scratch files, so anything left here is a leak. Fail before the trap deletes the evidence.
    leftovers=$(find "$run_dir" -mindepth 1 -maxdepth 1 -printf '%f\n')
    if [ -n "$leftovers" ]; then
        echo "test: the run left files in its scratch dir (TMPDIR). Each test must remove what it makes there. JS tests make scratch dirs with make_tmp_dir from test/support/tmp_dir.ts. Left over:" >&2
        echo "$leftovers" | sed 's/^/  /' >&2
        [ "$status" -ne 0 ] || status=1
    fi
    exit "$status"

[private]
install_deps:
    #!/usr/bin/env bash
    set -euo pipefail
    # web-ext is checked too, at the version package.json pins: a checkout that installed before web-ext was locked has node_modules without it, and sign would fail late.
    wanted=$(jq -r '.devDependencies["web-ext"] // empty' package.json)
    have=$(jq -r '.version // empty' node_modules/web-ext/package.json 2>/dev/null || true)
    if [ ! -d node_modules ] || [ ! -x node_modules/.bin/web-ext ] || [ "$have" != "$wanted" ]; then
        npm install --no-audit --no-fund
    fi

# Lint the config directory (default ~/.config/desertfox): build it in memory and print problems. Writes nothing Firefox reads, but the build prerequisite rewrites dist/ because the lint reads dist/commands.json. Extra flags (such as --schemas) go to the CLI.
build-config dir="" *flags="": build
    node tools/build-config/cli.ts {{ if dir == "" { "" } else { quote(dir) } }} {{flags}}

# Open a real Firefox window on the maintainer's desktop with a worktree's build, replacing that worktree's own window if one is open. Each argument after the worktree is one command the maintainer must type, quoted, for example ':set newtab_weather true'. See tools/owner_test/README.md.
[positional-arguments]
owner-test worktree="." *hints: install_deps
    node --no-warnings tools/owner_test/cli.ts open "$@"

# Rebuild a worktree and reload its test window in place, keeping its profile and granted permissions.
owner-test-reload worktree=".": install_deps
    node --no-warnings tools/owner_test/cli.ts reload {{quote(worktree)}}

# Show whether a worktree's test window is open.
owner-test-status worktree=".":
    node --no-warnings tools/owner_test/cli.ts status {{quote(worktree)}}

# Close a worktree's test window and delete its profile. Safe to run twice.
owner-test-close worktree=".":
    node --no-warnings tools/owner_test/cli.ts close {{quote(worktree)}}

# Open one visible Firefox window per tool, or only the one named by --tool <desertfox|vimium|vimiumc|tridactyl> (DesertFox from this checkout, Vimium, Vimium C, Tridactyl at the rig's pinned versions) in fresh profiles, each with the given URLs. See tools/measure/rivals/README.md.
[positional-arguments]
compare *urls:
    node --no-warnings tools/measure/rivals/compare.mjs open "$@"

# Open a URL as the active tab in every open compare window.
compare-add url:
    node --no-warnings tools/measure/rivals/compare.mjs add {{quote(url)}}

# Close the compare windows by their recorded pids and delete their profiles. Safe to run twice.
compare-close:
    node --no-warnings tools/measure/rivals/compare.mjs close

# Build main as pushed and publish it as a beta, by starting the CI beta workflow and watching its run. A failed run is not rerun: start `just beta` again. Needs gh, logged in.
beta:
    #!/usr/bin/env bash
    set -euo pipefail
    run_id=$(just beta_dispatch)
    gh run watch "$run_id" --exit-status

# Start the beta workflow on main and print the id of the run it started on stdout. Run ids only grow, so the id recorded before the dispatch tells this run from older ones.
[private]
beta_dispatch:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v gh >/dev/null 2>&1; then
        echo "beta: gh is not installed. Install the GitHub CLI first." >&2
        exit 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        echo "beta: gh is not logged in. Run 'gh auth login' first." >&2
        exit 1
    fi
    last_id=$(gh run list --workflow beta.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // 0')
    gh workflow run beta.yml --ref main >&2
    run_id=""
    for _ in $(seq 1 30); do
        run_id=$(gh run list --workflow beta.yml --event workflow_dispatch --branch main --limit 5 --json databaseId --jq "[.[] | select(.databaseId > $last_id)] | max_by(.databaseId) | .databaseId // empty")
        if [ -n "$run_id" ]; then break; fi
        sleep 2
    done
    if [ -z "$run_id" ]; then
        echo "beta: the workflow was started but its run did not show up within 60 s. Look at 'gh run list --workflow beta.yml'." >&2
        exit 1
    fi
    echo "$run_id"

# Python unit tests of the native host and its install script. The install tests use a temporary HOME and a stubbed curl.
host-test:
    python3 -m unittest discover -s host -p 'test_*.py'

# Real key presses in a nested session. A full run takes about 34 s on 8 shards. `just test-all` runs the unit tests beside it. One run at a time per machine: a second waits up to 900 s for the lock. Needs labwc, Hyprland, dbus-daemon and python3 (test/key/session.mjs).
key-test: build build-key-test
    #!/usr/bin/env bash
    set -euo pipefail
    # One run at a time: two sharded runs together break the memory budget. -o keeps the lock fd out of the run, so a session that outlives it does not hold the lock.
    lock_file=/tmp/desertfox-key-test.lock
    # A test Firefox that runs away would otherwise take the whole tmux window with it: the kernel kills it, and systemd then stops every process in the window's unit. In its own capped scope, only this run dies. The time limit is the run's own deadline plus a margin, so a serial run with a higher KEY_TEST_DEADLINE_S is not killed first. The margin covers the shutdown after the deadline: the worker stop grace (10 s, STOP_GRACE_MS in run.mjs), the session stop (about 5 s, in session.mjs) and the rest as slack for the sweep and the merge.
    deadline_s="${KEY_TEST_DEADLINE_S:-230}"
    if ! [[ "$deadline_s" =~ ^[1-9][0-9]*$ ]]; then deadline_s=230; fi
    # Inside agents.slice, keep the scope there too: a bare scope lands in app.slice and escapes the slice CPU cap.
    slice_args=(); if grep -q /agents.slice/ /proc/self/cgroup 2>/dev/null; then slice_args=(--slice=agents.slice); fi
    scope_args=(systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=16G -p MemoryHigh=14G -p MemorySwapMax=0 -p CPUQuota=1400% -p TimeoutStopSec=20 -p RuntimeMaxSec=$((deadline_s + 70)))
    run_cmd=(node test/key/run.mjs)
    if command -v systemd-run >/dev/null 2>&1 && "${scope_args[@]}" true >/dev/null 2>&1; then
        run_cmd=("${scope_args[@]}" "${run_cmd[@]}")
    else
        echo "key-test: no systemd user session, so this run has no memory cap." >&2
    fi
    if ! flock -n -o "$lock_file" true; then
        echo "key-test: the lock $lock_file is busy, waiting up to 900 s. Holders:" >&2
        # An outer flock on this file around the recipe holds it for the whole wait. Never wrap the recipe in flock.
        for holder_pid in $(fuser "$lock_file" 2>/dev/null); do
            ps -o pid=,args= -p "$holder_pid" >&2 || true
        done
    fi
    exec flock -o -w 900 "$lock_file" "${run_cmd[@]}"

# Run `just test` and `just key-test` at the same time, so one command takes about as long as the key test alone (about 35 s). The unit tests start with the build and end before the shards start. Both always run to the end. The unit-test output prints only if it fails. Exit 1 if either failed. The environment (KEY_TEST_PIECES and the rest) goes to both unchanged.
test-all: install_deps
    #!/usr/bin/env bash
    set -uo pipefail
    # Job control gives the unit tests their own process group, so the exit trap can stop the whole `just test` tree, systemd scope included.
    set -m
    unit_log=$(mktemp /tmp/desertfox-test-all.XXXXXX)
    unit_pid=
    stop_unit_tests() {
        if [ -n "$unit_pid" ]; then kill -TERM -- "-$unit_pid" 2>/dev/null; wait "$unit_pid" 2>/dev/null; fi
        rm -f "$unit_log"
    }
    trap stop_unit_tests EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    start_s=$SECONDS
    just test >"$unit_log" 2>&1 &
    unit_pid=$!
    just key-test
    key_status=$?
    wait "$unit_pid"
    unit_status=$?
    unit_pid=
    failed=0
    if [ "$unit_status" -eq 0 ]; then
        echo "test: ok"
    else
        cat "$unit_log"
        echo "test: FAIL (exit $unit_status)"
        failed=1
    fi
    if [ "$key_status" -eq 0 ]; then
        echo "key-test: ok"
    else
        echo "key-test: FAIL (exit $key_status)"
        failed=1
    fi
    echo "test-all: $((SECONDS - start_s)) s"
    exit "$failed"

# Record the README demo: a looping GIF of seven shots with a key overlay, a GIF of the board scene, two GIFs of item mode on live sites and four 1280x800 stills, written to docs/images (or DEMO_OUT_DIR) only when the whole run worked. Plays real key presses in a key-test session and films it with wf-recorder, so it needs wf-recorder, ffmpeg, grim and the key-test tools. Takes the key-test lock, so never wrap it in `flock`. About 2 minutes.
readme-demo: build build-key-test
    #!/usr/bin/env bash
    set -euo pipefail
    lock_file=/tmp/desertfox-key-test.lock
    if ! flock -n -o "$lock_file" true; then
        echo "readme-demo: the lock $lock_file is busy, waiting up to 900 s. Holders:" >&2
        for holder_pid in $(fuser "$lock_file" 2>/dev/null); do
            ps -o pid=,args= -p "$holder_pid" >&2 || true
        done
    fi
    exec flock -o -w 900 "$lock_file" node test/key/demo.mjs

# Replay the key-test lifecycle probes: signals at startup and mid-run, a killed worker, a crashed Firefox, the deadline, distinct ports, a foreign sweep and a SIGKILLed run followed by a rerun. Serial, about 2 minutes, one probe at a time. Takes the key-test lock like `just key-test`, so never wrap it in `flock`. Name probes to run only those: `just key-test-lifecycle deadline kill-worker`.
key-test-lifecycle *probes: build build-key-test
    #!/usr/bin/env bash
    set -euo pipefail
    # The lock and scope lines repeat those of key-test. The scope's time limit covers every probe, each of which stops its own runs.
    lock_file=/tmp/desertfox-key-test.lock
    # Inside agents.slice, keep the scope there too: a bare scope lands in app.slice and escapes the slice CPU cap.
    slice_args=(); if grep -q /agents.slice/ /proc/self/cgroup 2>/dev/null; then slice_args=(--slice=agents.slice); fi
    scope_args=(systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=16G -p MemoryHigh=14G -p MemorySwapMax=0 -p CPUQuota=1400% -p TimeoutStopSec=20 -p RuntimeMaxSec=900)
    run_cmd=(node test/key/lifecycle_probe.mjs {{probes}})
    if command -v systemd-run >/dev/null 2>&1 && "${scope_args[@]}" true >/dev/null 2>&1; then
        run_cmd=("${scope_args[@]}" "${run_cmd[@]}")
    else
        echo "key-test-lifecycle: no systemd user session, so this run has no memory cap." >&2
    fi
    if ! flock -n -o "$lock_file" true; then
        echo "key-test-lifecycle: the lock $lock_file is busy, waiting up to 900 s. Holders:" >&2
        for holder_pid in $(fuser "$lock_file" 2>/dev/null); do
            ps -o pid=,args= -p "$holder_pid" >&2 || true
        done
    fi
    exec flock -o -w 900 "$lock_file" "${run_cmd[@]}"

# Run `just key-test` n times (default 10) and append one line to the flake history (~/.local/state/desertfox/key-test-flakes.jsonl, or KEY_TEST_FLAKES_HISTORY). Each run waits up to 900 s for the lock, and a run with no report counts as a run error. Sweeps leftover run folders first. Exits 1 and sends a notify-send alert when a case fails in 2 or more runs or 3 or more runs error. Keeps the reports and logs in .logs/key-test-flakes-<stamp>/. Run it when you suspect a flaky test.
key-test-flakes n="10": build
    #!/usr/bin/env bash
    set -uo pipefail
    n={{quote(n)}}
    if ! [[ "$n" =~ ^[1-9][0-9]*$ ]]; then echo "key-test-flakes: n must be a positive number, got $n" >&2; exit 2; fi
    node test/key/flakes.mjs sweep
    batch_dir=".logs/key-test-flakes-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$batch_dir"
    reports=()
    for i in $(seq 1 "$n"); do
        echo "key-test-flakes: run $i of $n"
        KEY_TEST_TIMINGS_FILE="$batch_dir/run-$i.json" just key-test >"$batch_dir/run-$i.log" 2>&1
        echo "key-test-flakes: run $i exit $?"
        reports+=("$batch_dir/run-$i.json")
    done
    exec node test/key/flakes.mjs fold "$(git rev-parse --short HEAD)" "${reports[@]}"

# Rewrite test/key/piece_seconds.json, the piece weights that order the sharded key test, from a full-run timings file (default: the newest .logs/key-test-timings-*.json that no KEY_TEST_ONLY filtered). Run it in the last PR of a change that moves piece run times.
key-test-weights timings="":
    node test/key/shards.mjs write-weights {{ if timings == "" { "" } else { quote(timings) } }}

# Run only the key-test pieces whose areas match the src diff against base (default origin/main). With head, the diff is base...head. A shared file runs every piece, no src change runs none. test/key/areas.mjs holds the table.
key-test-changed base="origin/main" head="":
    #!/usr/bin/env bash
    set -euo pipefail
    pieces=$(node test/key/areas.mjs {{quote(base)}} {{quote(head)}})
    if [ -z "$pieces" ]; then exit 0; fi
    KEY_TEST_PIECES="$pieces" exec just key-test

# Sign dist/ as an unlisted add-on on addons.mozilla.org. Reads the AMO key from the environment only.
sign: build
    just sign_only

# The signing alone: it builds nothing and installs nothing, so the AMO key reaches no other command. CI runs it in its own job with only the key. It needs dist/ and the locked web-ext already in place. With no arguments it signs unlisted and downloads the xpi. The channel `listed` also takes the listing metadata file and the source archive, and downloads nothing: Mozilla reviews the version first.
[private]
sign_only channel="unlisted" metadata="" source="":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${WEB_EXT_API_KEY:-}" ] || [ -z "${WEB_EXT_API_SECRET:-}" ]; then
        echo "sign needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET (the AMO JWT issuer and secret) in the environment." >&2
        exit 2
    fi
    # Read the version from the installed package.json, so nothing runs before the check. package.json pins it exactly and the lockfile agrees.
    wanted=$(jq -r '.devDependencies["web-ext"] // empty' package.json)
    have=$(jq -r '.version // empty' node_modules/web-ext/package.json 2>/dev/null || true)
    if [ ! -x node_modules/.bin/web-ext ] || [ -z "$wanted" ] || [ "$have" != "$wanted" ]; then
        echo "sign needs web-ext $wanted in node_modules, found '${have:-none}'. Run 'npm ci' first." >&2
        exit 1
    fi
    if [ ! -f dist/manifest.json ]; then
        echo "sign needs a built dist/. Run 'just build' first." >&2
        exit 1
    fi
    rm -rf web-ext-artifacts
    # web-ext 10.7.0 does not create the folder before it downloads the xpi.
    mkdir -p web-ext-artifacts
    # The four page bundles build with source maps for local debugging. The store xpi leaves them out.
    channel={{quote(channel)}}
    metadata={{quote(metadata)}}
    source={{quote(source)}}
    listing_args=()
    if [ "$channel" = "listed" ]; then
        if [ ! -f "$metadata" ] || [ ! -f "$source" ]; then
            echo "A listed sign needs the metadata file and the source archive, found '$metadata' and '$source'." >&2
            exit 1
        fi
        # 0 skips the wait for approval: a listed version waits for Mozilla's review, days or weeks.
        listing_args=(--amo-metadata "$metadata" --upload-source-code "$source" --approval-timeout 0)
    elif [ "$channel" != "unlisted" ]; then
        echo "sign_only takes the channel listed or unlisted, not '$channel'." >&2
        exit 1
    fi
    node_modules/.bin/web-ext sign --channel="$channel" --source-dir dist --artifacts-dir web-ext-artifacts --ignore-files "**/*.map" "${listing_args[@]}"
    if [ "$channel" = "unlisted" ]; then ls web-ext-artifacts/*.xpi; fi

# Copy the signed add-on into a Firefox profile. Firefox loads it at the next start. No sudo.
install-profile profile_dir:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    xpis=(web-ext-artifacts/*.xpi)
    if [ "${#xpis[@]}" -ne 1 ]; then
        echo "install-profile needs exactly one signed xpi in web-ext-artifacts/. Run 'just sign' first." >&2
        exit 1
    fi
    mkdir -p "{{profile_dir}}/extensions"
    # The xpi of the id before the rename, split so the rename check does not count it. Firefox would load both add-ons otherwise.
    rm -f "{{profile_dir}}/extensions/oasis""fox@uhs-robert.xpi"
    cp "${xpis[0]}" "{{profile_dir}}/extensions/desertfox@uhs-robert.xpi"
    echo "installed {{profile_dir}}/extensions/desertfox@uhs-robert.xpi"

# Install the signed add-on for every profile through Firefox's policy file. Needs sudo and jq.
install:
    bash tools/install_policy.sh

# Entry in the rbw vault that holds the AMO key: the secret as password, the issuer in the notes.
export AMO_RBW_ENTRY := env("AMO_RBW_ENTRY", "Firefox AMO API Key")

# Refuse to release from main, a detached HEAD or with uncommitted changes, so a bump never lands on main or mixes with other work.
[private]
release_guard:
    #!/usr/bin/env bash
    set -euo pipefail
    branch=$(git branch --show-current)
    if [ -z "$branch" ] || [ "$branch" = "main" ]; then
        echo "release refuses to run on main or a detached HEAD. Switch to a release branch first." >&2
        exit 1
    fi
    changed=$(git status --porcelain)
    if [ -z "$changed" ]; then
        exit 0
    fi
    # A bump left behind by a failed sign or install looks like this.
    if [ -z "$(git status --porcelain -- . ':!package.json' ':!package-lock.json' ':!src/manifest.json')" ]; then
        echo "release found changes only in package.json, package-lock.json and src/manifest.json. That may be a bump left by a failed sign or install. Run 'git diff HEAD -- package.json package-lock.json src/manifest.json'. If it shows only the version line, run 'git checkout -- package.json package-lock.json src/manifest.json' and rerun. Otherwise commit or keep your edits. If signing succeeded, do not rerun: run 'just release_commit_push' and then 'just release_publish <version> <xpi> $RELEASE_ASSETS_DIR/release-notes-<version>.md' and 'just release_notes_reset <version>' instead. They use the stamped files kept in $RELEASE_ASSETS_DIR." >&2
        exit 1
    fi
    echo "release refuses to run with uncommitted changes. Commit or stash them first." >&2
    exit 1

# Raise the patch version in package.json, package-lock.json and src/manifest.json. AMO rejects a version it has already signed. Runs no git.
[private]
release_bump:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v jq >/dev/null || { echo "release needs jq to edit src/manifest.json." >&2; exit 1; }
    npm version patch --no-git-tag-version >/dev/null
    new_version=$(jq -r .version package.json)
    manifest_tmp=$(mktemp)
    jq --arg version "$new_version" '.version = $version' src/manifest.json > "$manifest_tmp"
    mv "$manifest_tmp" src/manifest.json
    echo "bumped version to $new_version"

# Commit the version bump on the release branch and push the branch, so the release tag can point at a commit that exists on the remote and carries the released code.
[private]
release_commit_push:
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(jq -r .version package.json)
    git add package.json package-lock.json src/manifest.json
    # A rerun after a failed push finds the bump already committed.
    if ! git diff --cached --quiet; then
        git commit -q -m "chore(release): bump version to $version" || { echo "The bump commit failed, so the bump is uncommitted. Fix git, then run 'just release_commit_push', 'just release_publish <version> <xpi> $RELEASE_ASSETS_DIR/release-notes-<version>.md' and 'just release_notes_reset <version>'. Do not rerun 'just release': it signs a second version." >&2; exit 1; }
    fi
    git push -u origin "$(git branch --show-current)" || { echo "The push failed. The bump commit is local. Fix the push, then run 'just release_commit_push', 'just release_publish <version> <xpi> $RELEASE_ASSETS_DIR/release-notes-<version>.md' and 'just release_notes_reset <version>'. Do not rerun 'just release': it signs a second version." >&2; exit 1; }

# Folder of the stamped release files, kept between the recipes of one release so publish uploads the bytes the build hashed.
export RELEASE_ASSETS_DIR := env("RELEASE_ASSETS_DIR", "release-assets")

# Stamp the hosts with the given version and hash them into RELEASE_ASSETS_DIR (tools/release_stamp.mjs). The extension build copies host_sha256.json into dist/, so the signed build carries the hashes.
[private]
release_stamp version:
    # Callers pass the version from src/manifest.json, not package.json: npm refuses x.y.z.N, so a beta lives in the manifest only and package.json keeps the last stable version. A script, not recipe code, so BUILD.md can give a reviewer the same step without just.
    node tools/release_stamp.mjs {{quote(version)}}

# Create the GitHub release v<version> from the files release_stamp wrote: the stamped hosts, the command line, their checksums, the install script and the signed xpi as desertfox-<version>.xpi, so a release build installs the host of its own version and a beta can update through updates.json. The xpi is the given file, and a missing one fails unless RELEASE_DRY_RUN=1. With no xpi argument the release carries the hosts only, for a listed version whose xpi AMO signs later (add it with `gh release upload`). With a notes file the release body is that file, and an empty or missing file fails. Without one the body is a one-line note, for the beta workflow and the listed submit. A four-number version (x.y.z.N) is a prerelease. The tag targets HEAD, so push it first (release does). RELEASE_DRY_RUN=1 prints the gh command and creates nothing, and accepts a missing xpi.
[private]
release_publish version xpi="" notes_file="":
    #!/usr/bin/env bash
    set -euo pipefail
    version={{quote(version)}}
    xpi={{quote(xpi)}}
    notes_file={{quote(notes_file)}}
    if [ -n "$notes_file" ] && [ ! -s "$notes_file" ]; then
        echo "release_publish: the notes file $notes_file is missing or empty." >&2
        exit 1
    fi
    assets="$RELEASE_ASSETS_DIR"
    xpi_asset="$assets/desertfox-$version.xpi"
    # Publish only the bytes the extension build hashed. Restamping here would upload files the signed build does not know.
    if [ "$(jq -r .version "$assets/host_sha256.json" 2>/dev/null)" != "$version" ]; then
        echo "release_publish found no files stamped as $version in $assets. Run 'just release_stamp' on the commit that was signed, so the files match the hashes the signed build carries. Do not sign this version again: AMO refuses a second signing." >&2
        exit 1
    fi
    for script in desertfox-host desertfox-bridge; do
        grep -qx "RELEASE_VERSION = \"$version\"" "$assets/$script" || { echo "release_publish: $assets/$script is not stamped as $version." >&2; exit 1; }
    done
    (cd "$assets" && sha256sum --quiet -c desertfox-host.sha256 desertfox-bridge.sha256 desertfox.sha256) || { echo "release_publish: a file in $assets no longer matches its checksum." >&2; exit 1; }
    # The signed build carries host_sha256.json, so a file that matches only its own .sha256 would fail every update.
    for script in desertfox-host desertfox-bridge desertfox; do
        if [ "$(jq -r --arg name "$script" '.sha256[$name]' "$assets/host_sha256.json")" != "$(cut -d ' ' -f 1 "$assets/$script.sha256")" ]; then
            echo "release_publish: $assets/$script does not match its hash in host_sha256.json, which the signed build carries. Run 'just release_stamp' on the commit that was signed." >&2
            exit 1
        fi
    done
    # The install command on the Help page checks install.sh against this hash before it runs it.
    if [ "$(jq -r .install_sh "$assets/host_sha256.json")" != "$(sha256sum "$assets/install.sh" | cut -d ' ' -f 1)" ]; then
        echo "release_publish: $assets/install.sh does not match install_sh in host_sha256.json, which the signed build carries. Run 'just release_stamp' on the commit that was signed." >&2
        exit 1
    fi
    xpi_args=()
    if [ -f "$xpi" ]; then
        # The release asset name is the file name, and updates.json links to exactly this one.
        if [ "$(realpath "$xpi")" != "$(realpath -m "$xpi_asset")" ]; then cp -f "$xpi" "$xpi_asset"; fi
        xpi_args=("$xpi_asset")
    elif [ -z "$xpi" ]; then
        echo "no xpi given: the release carries the hosts only."
    elif [ "${RELEASE_DRY_RUN:-}" = "1" ]; then
        echo "dry run: $xpi does not exist, so $xpi_asset is not written."
        xpi_args=("$xpi_asset")
    else
        echo "release_publish: the xpi $xpi does not exist. Run 'just sign' first." >&2
        exit 1
    fi
    gh_command=(gh release create "v$version" "$assets/desertfox-host" "$assets/desertfox-host.sha256" "$assets/desertfox-bridge" "$assets/desertfox-bridge.sha256" "$assets/desertfox" "$assets/desertfox.sha256" "$assets/install.sh" "${xpi_args[@]}" --target "$(git rev-parse HEAD)" --title "v$version")
    # Only `just release` passes a notes file. The beta workflow and the listed submit keep the one-line note, because their releases have no hand-written notes.
    if [ -n "$notes_file" ]; then
        gh_command+=(--notes-file "$notes_file")
    else
        gh_command+=(--notes "Native hosts $version. The extension's :native.install page shows the command that installs it.")
    fi
    if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        gh_command+=(--prerelease)
    fi
    if [ "${RELEASE_DRY_RUN:-}" = "1" ]; then
        echo "dry run: ${gh_command[*]}"
        cat "$assets/desertfox-host.sha256" "$assets/desertfox-bridge.sha256" "$assets/desertfox.sha256"
        exit 0
    fi
    "${gh_command[@]}"
    echo "created GitHub release v$version"

# Install the signed add-on, unless the machine's policy follows the beta: the stable install would replace the beta pin. Beta means the policy's install_url for the add-on is an https URL, as `install_policy.sh beta` writes it.
[private]
release_install:
    #!/usr/bin/env bash
    set -euo pipefail
    policies_file="${DESERTFOX_POLICIES_FILE:-/etc/firefox/policies/policies.json}"
    install_url=""
    if [ -f "$policies_file" ]; then
        install_url=$(jq -r '.policies.ExtensionSettings["desertfox@uhs-robert"].install_url // ""' "$policies_file" 2>/dev/null || true)
    fi
    if [[ "$install_url" == https://* ]]; then
        echo "Skipped the local install because this machine is on beta. The policy keeps the beta."
        exit 0
    fi
    just install

# Print the path of RELEASE.md in the main checkout, where release worktrees share one notes file. RELEASE_NOTES_FILE replaces it.
[private]
release_notes_file:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "${RELEASE_NOTES_FILE:-}" ]; then echo "$RELEASE_NOTES_FILE"; exit 0; fi
    # The common git dir is <main checkout>/.git for the main checkout and for every worktree of it.
    echo "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/RELEASE.md"

# Reset RELEASE.md to an empty "# Next release" section, since the published notes live on the GitHub release. `release` runs it after the publish, unless RELEASE.md changed since the notes were taken (the snapshot kept beside the notes file). Run it by hand after a recovery `release_publish`, which never touches RELEASE.md.
[private]
release_notes_reset version:
    node tools/release_notes.mjs reset "$(just release_notes_file)" "$RELEASE_ASSETS_DIR/release-notes-{{version}}.source.md"

# Bump the patch version, stamp and hash the hosts, sign dist/ with those hashes, install it for every profile (skipped on a machine whose policy follows the beta) and create the GitHub release with the same stamped hosts. The matching beta comes after the release PR merges: the nightly builds it because main changed, or run `just beta` for it at once. Fills the AMO key from rbw when either variable is empty. Needs a clean release branch and the release text under "# Next release" in RELEASE.md of the main checkout (git-ignored, see tools/release_notes.mjs), which must be non-empty before anything else runs. Once the release is published, the file is reset to an empty "# Next release" section.
release:
    #!/usr/bin/env bash
    set -euo pipefail
    # First, before any bump, sign, commit, push or gh call: the release body is hand-written, never a default.
    notes_source=$(just release_notes_file)
    node tools/release_notes.mjs next "$notes_source" >/dev/null
    # The key lives in shell variables that are never exported, so the build and install steps cannot read it. Only the sign command gets it. A key already in the environment moves into those variables before any child command runs. Build code on this machine stays trusted: it can still reach node_modules and an unlocked rbw.
    amo_key="${WEB_EXT_API_KEY:-}"
    amo_secret="${WEB_EXT_API_SECRET:-}"
    unset WEB_EXT_API_KEY WEB_EXT_API_SECRET
    just release_guard
    # Before the bump, so a missing dependency never leaves a bump behind.
    just install_deps
    # Fail before the bump and the signing, so a missing gh login does not leave a signed version with no host release.
    command -v gh >/dev/null || { echo "release needs gh to create the GitHub release that carries the native host." >&2; exit 1; }
    gh auth status >/dev/null 2>&1 || { echo "release needs a logged-in gh. Run 'gh auth login', then retry." >&2; exit 1; }
    source tools/amo_key.sh
    load_amo_key
    just release_bump
    version=$(jq -r .version src/manifest.json)
    just release_stamp "$version"
    # Kept with the stamped files so a recovery run of release_publish sends the same text, even though RELEASE.md changes only after the publish.
    notes_file="$RELEASE_ASSETS_DIR/release-notes-$version.md"
    node tools/release_notes.mjs text "$notes_source" "$version" > "$notes_file"
    cp "$notes_source" "$RELEASE_ASSETS_DIR/release-notes-$version.source.md"
    # Check before signing: AMO signs a version once, so a build without the hashes must never reach it.
    just build
    if ! cmp -s "$RELEASE_ASSETS_DIR/host_sha256.json" dist/host_sha256.json; then
        echo "The build does not carry the host hashes in $RELEASE_ASSETS_DIR/host_sha256.json, so its hosts could not update. Nothing was signed. Fix the build, undo the bump with 'git checkout -- package.json package-lock.json src/manifest.json', then rerun 'just release'." >&2
        exit 1
    fi
    WEB_EXT_API_KEY="$amo_key" WEB_EXT_API_SECRET="$amo_secret" just sign_only
    just release_install
    just release_commit_push
    xpi=$(ls web-ext-artifacts/*.xpi)
    just release_publish "$version" "$xpi" "$notes_file" || { echo "The add-on is signed and installed and the bump is pushed, but the GitHub release failed. After fixing gh, run 'just release_publish $version $xpi $notes_file', then 'just release_notes_reset <version>'. RELEASE.md is unchanged until then." >&2; exit 1; }
    just release_notes_reset "$version"
    echo "Released $(jq -r .version package.json). The bump is committed and pushed on this branch. Open a PR."

# Write the source archive Mozilla reviewers rebuild from, to RELEASE_ASSETS_DIR/desertfox-<version>-source.zip: every tracked file of HEAD, with BUILD.md at the top. It holds no stamped hosts, since BUILD.md has the reviewer stamp them. Needs a clean tree, so the archive is the commit that gets signed.
source_archive:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        echo "source_archive refuses to run with uncommitted changes: the archive is HEAD, so it would not match the build." >&2
        exit 1
    fi
    version=$(jq -r .version src/manifest.json)
    mkdir -p "$RELEASE_ASSETS_DIR"
    archive="$RELEASE_ASSETS_DIR/desertfox-$version-source.zip"
    git archive --format=zip -o "$archive" HEAD
    echo "$archive"

# Submit dist/ to the listed channel on addons.mozilla.org with the listing text in amo/metadata.json and the source archive. PUBLIC and one-way: AMO signs a version number once, and the listing page exists afterwards. It stamps and builds the version in src/manifest.json itself so the build, the archive and the hosts agree, and refuses a beta version or an update_url, which only unlisted builds carry. Mozilla then reviews it. Publish the GitHub release with the hosts first (`just release_publish <version>`), because the install command of the add-on points at it. Needs a clean release branch with the version bump committed. CI never runs it.
sign_listed:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "${CI:-}" ]; then
        echo "sign_listed never runs in CI: a listed submission is public and one-way." >&2
        exit 1
    fi
    # Same rule as release: the key stays in unexported shell variables and no build step can read it.
    amo_key="${WEB_EXT_API_KEY:-}"
    amo_secret="${WEB_EXT_API_SECRET:-}"
    unset WEB_EXT_API_KEY WEB_EXT_API_SECRET
    just release_guard
    just install_deps
    version=$(jq -r .version src/manifest.json)
    if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "sign_listed needs a three-number version, found '$version'. Four numbers are betas." >&2
        exit 1
    fi
    if [ -n "$(jq -r '.browser_specific_settings.gecko.update_url // empty' src/manifest.json)" ]; then
        echo "sign_listed refuses a manifest with an update_url: AMO updates a listed add-on itself." >&2
        exit 1
    fi
    jq -e '.version.license and (.summary["en-US"] | length <= 250)' amo/metadata.json >/dev/null || { echo "amo/metadata.json needs version.license and a summary of at most 250 characters." >&2; exit 1; }
    # Before the build, so a locked rbw vault fails at once and not after the build.
    source tools/amo_key.sh
    load_amo_key
    just release_stamp "$version"
    just build
    # The stamp hashes the local hosts, not the published ones: a host change after the release is published needs a new version.
    # Check before submitting: AMO signs a version once, so a build without the hashes must never reach it.
    if ! cmp -s "$RELEASE_ASSETS_DIR/host_sha256.json" dist/host_sha256.json; then
        echo "The build does not carry the host hashes in $RELEASE_ASSETS_DIR/host_sha256.json. Nothing was submitted." >&2
        exit 1
    fi
    archive=$(just source_archive)
    WEB_EXT_API_KEY="$amo_key" WEB_EXT_API_SECRET="$amo_secret" just sign_only listed amo/metadata.json "$archive"
    echo "Submitted $version for review. Publish the GitHub release with the hosts now if you have not: 'just release_publish $version' (push the commit first, since the tag targets HEAD). Paste docs/privacy.md into the privacy policy field and add the previews on the listing page (see amo/README.md)."

# Everything the beta does before signing, with no secret: check the stamped manifest, stamp and hash the hosts, build dist/ and check that it carries the hashes. CI runs it as its own job.
[private]
release_beta_build:
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(jq -r .version src/manifest.json)
    if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[1-9][0-9]*$ ]]; then
        echo "release_beta: src/manifest.json holds '$version', not a beta version x.y.z.N. Stamp it with tools/stamp_beta_manifest.ts first." >&2
        exit 1
    fi
    if [ -z "$(jq -r '.browser_specific_settings.gecko.update_url // empty' src/manifest.json)" ]; then
        echo "release_beta: src/manifest.json has no update_url, so no beta could update. Stamp it with tools/stamp_beta_manifest.ts first." >&2
        exit 1
    fi
    just release_stamp "$version"
    just build
    # Check before signing: AMO signs a version once, so a build without the hashes must never reach it.
    if ! cmp -s "$RELEASE_ASSETS_DIR/host_sha256.json" dist/host_sha256.json; then
        echo "release_beta: the build does not carry the host hashes in $RELEASE_ASSETS_DIR/host_sha256.json. Nothing was signed." >&2
        exit 1
    fi

# Build the beta in the workspace as stamped in src/manifest.json (see tools/stamp_beta_manifest.ts): release_beta_build, then sign dist/, then create the prerelease v<version> with the signed xpi attached. CI runs the same recipes as separate jobs, each with only the secret it needs. Never bumps, never writes package.json, never installs and never commits. RELEASE_DRY_RUN=1 skips the signing and the release and runs the rest. Reads the AMO key from the environment only.
release_beta:
    #!/usr/bin/env bash
    set -euo pipefail
    just release_beta_build
    version=$(jq -r .version src/manifest.json)
    # Fail before the signing, so a missing gh login does not leave a signed version with no release.
    command -v gh >/dev/null || { echo "release_beta needs gh to create the GitHub release." >&2; exit 1; }
    gh auth status >/dev/null 2>&1 || { echo "release_beta needs a logged-in gh. Run 'gh auth login', then retry." >&2; exit 1; }
    xpi="web-ext-artifacts/desertfox-$version.xpi"
    if [ "${RELEASE_DRY_RUN:-}" != "1" ]; then
        just sign_only
        xpi=$(ls web-ext-artifacts/*.xpi)
    else
        echo "dry run: skipping sign."
    fi
    just release_publish "$version" "$xpi" || { echo "The add-on is signed, but the GitHub release failed. Do not sign this version again. After fixing gh, run 'just release_publish $version $xpi'." >&2; exit 1; }
