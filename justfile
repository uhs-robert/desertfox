default:
    @just --list

# Regenerate the binding tables in docs/keymap.md from the default keymap.
docs-gen: install_deps
    npm run --silent docs:gen

# Regenerate src/shared/themes.ts from themes/oasis/*.css and themes/*.toml, and the palette names in src/shared/setting_completion.ts.
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

# Typecheck, then bundle the extension into dist/.
build: install_deps
    npm run --silent typecheck
    npm run --silent build

# Check no old-name tokens remain, docs/keymap.md, src/shared/themes.ts, src/shared/default_settings.ts and src/shared/setting_completion.ts are current, then run the unit tests from TypeScript source by Node's type stripping, and the Python host tests. `just test-all` runs this beside `just key-test`.
test: install_deps
    #!/usr/bin/env bash
    set -euo pipefail
    # A test that runs away dies with its scope, so nothing outlives the run. The host tests share the scope and its time limit.
    all_tests='just host-test && npm run --silent test'
    # Inside agents.slice, keep the scope there too: a bare scope lands in app.slice and escapes the slice CPU cap.
    slice_args=(); if grep -q /agents.slice/ /proc/self/cgroup 2>/dev/null; then slice_args=(--slice=agents.slice); fi
    if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 true >/dev/null 2>&1; then
        exec systemd-run --user --scope "${slice_args[@]}" --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 bash -c "$all_tests"
    fi
    echo "test: no systemd user session, so this run has no memory cap or time limit." >&2
    exec bash -c "$all_tests"

[private]
install_deps:
    @test -d node_modules || npm install --no-audit --no-fund

# Lint the config directory (default ~/.config/desertfox): build it in memory and print problems. Writes nothing Firefox reads, but the build prerequisite rewrites dist/ because the lint reads dist/commands.json. Extra flags (such as --schemas) go to the CLI.
build-config dir="" *flags="": build
    node tools/build-config/cli.ts {{ if dir == "" { "" } else { quote(dir) } }} {{flags}}

# Python unit tests of the native host and its install script. The install tests use a temporary HOME and a stubbed curl.
host-test:
    python3 -m unittest discover -s host -p 'test_*.py'

# Real key presses in a nested session. A full run takes about 34 s on 8 shards. `just test-all` runs the unit tests beside it. One run at a time per machine: a second waits up to 900 s for the lock. Needs labwc, Hyprland, dbus-daemon and python3 (test/key/session.mjs).
key-test: build
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

# Replay the key-test lifecycle probes: signals at startup and mid-run, a killed worker, a crashed Firefox, the deadline, distinct ports, a foreign sweep and a SIGKILLed run followed by a rerun. Serial, about 2 minutes, one probe at a time. Takes the key-test lock like `just key-test`, so never wrap it in `flock`. Name probes to run only those: `just key-test-lifecycle deadline kill-worker`.
key-test-lifecycle *probes: build
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
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${WEB_EXT_API_KEY:-}" ] || [ -z "${WEB_EXT_API_SECRET:-}" ]; then
        echo "sign needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET (the AMO JWT issuer and secret) in the environment." >&2
        exit 2
    fi
    rm -rf web-ext-artifacts
    # web-ext 10.7.0 does not create the folder before it downloads the xpi.
    mkdir -p web-ext-artifacts
    npx --yes web-ext@10.7.0 sign --channel=unlisted --source-dir dist --artifacts-dir web-ext-artifacts
    ls web-ext-artifacts/*.xpi

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
        echo "release found changes only in package.json, package-lock.json and src/manifest.json. That may be a bump left by a failed sign or install. Run 'git diff HEAD -- package.json package-lock.json src/manifest.json'. If it shows only the version line, run 'git checkout -- package.json package-lock.json src/manifest.json' and rerun. Otherwise commit or keep your edits. If signing succeeded, do not rerun: run 'just release_commit_push' and then 'just release_publish' instead." >&2
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
        git commit -q -m "chore(release): bump version to $version" || { echo "The bump commit failed, so the bump is uncommitted. Fix git, then run 'just release_commit_push' and 'just release_publish'. Do not rerun 'just release': it signs a second version." >&2; exit 1; }
    fi
    git push -u origin "$(git branch --show-current)" || { echo "The push failed. The bump commit is local. Fix the push, then run 'just release_commit_push' and 'just release_publish'. Do not rerun 'just release': it signs a second version." >&2; exit 1; }

# Create the GitHub release v<package.json version> with the host, its checksum and the install script, so a release build installs the host of its own version. The tag targets HEAD, so push it first (release does). RELEASE_DRY_RUN=1 prints the gh command and creates nothing.
[private]
release_publish:
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(jq -r .version package.json)
    assets=$(mktemp -d)
    trap 'rm -rf "$assets"' EXIT
    cp host/desertfox-host host/desertfox-bridge host/install.sh "$assets/"
    (cd "$assets" && sha256sum desertfox-host > desertfox-host.sha256 && sha256sum desertfox-bridge > desertfox-bridge.sha256)
    gh_command=(gh release create "v$version" "$assets/desertfox-host" "$assets/desertfox-host.sha256" "$assets/desertfox-bridge" "$assets/desertfox-bridge.sha256" "$assets/install.sh" --target "$(git rev-parse HEAD)" --title "v$version" --notes "Native hosts $version. The extension's :native.install page shows the command that installs it.")
    if [ "${RELEASE_DRY_RUN:-}" = "1" ]; then
        echo "dry run: ${gh_command[*]}"
        cat "$assets/desertfox-host.sha256" "$assets/desertfox-bridge.sha256"
        exit 0
    fi
    "${gh_command[@]}"
    echo "created GitHub release v$version"

# Bump the patch version, sign dist/, install it for every profile and create the GitHub release with the native host. Fills the AMO key from rbw when either variable is empty. Needs a clean release branch.
release:
    #!/usr/bin/env bash
    set -euo pipefail
    just release_guard
    # Fail before the bump and the signing, so a missing gh login does not leave a signed version with no host release.
    command -v gh >/dev/null || { echo "release needs gh to create the GitHub release that carries the native host." >&2; exit 1; }
    gh auth status >/dev/null 2>&1 || { echo "release needs a logged-in gh. Run 'gh auth login', then retry." >&2; exit 1; }
    if [ -z "${WEB_EXT_API_KEY:-}" ] || [ -z "${WEB_EXT_API_SECRET:-}" ]; then
        for tool in rbw jq; do
            command -v "$tool" >/dev/null || { echo "release needs $tool to read the AMO key from rbw. Install it, or set WEB_EXT_API_KEY and WEB_EXT_API_SECRET." >&2; exit 1; }
        done
        rbw unlocked >/dev/null 2>&1 || { echo "release needs an unlocked rbw vault. Run 'rbw unlock', then retry." >&2; exit 1; }
        entry_json=$(rbw get --raw "$AMO_RBW_ENTRY") || { echo "release could not read the rbw entry '$AMO_RBW_ENTRY'." >&2; exit 1; }
        WEB_EXT_API_KEY=$(jq -r '.notes // ""' <<<"$entry_json" | grep -o -m1 'user:[0-9]*:[0-9]*' || true)
        if [ -z "$WEB_EXT_API_KEY" ]; then
            echo "The notes of rbw entry '$AMO_RBW_ENTRY' hold no issuer (user:N:N)." >&2
            exit 1
        fi
        WEB_EXT_API_SECRET=$(jq -r '.data.password // ""' <<<"$entry_json")
        unset entry_json
        if [ -z "$WEB_EXT_API_SECRET" ]; then
            echo "The password of rbw entry '$AMO_RBW_ENTRY' is empty." >&2
            exit 1
        fi
        export WEB_EXT_API_KEY WEB_EXT_API_SECRET
    fi
    just release_bump
    just sign
    just install
    just release_commit_push
    just release_publish || { echo "The add-on is signed and installed and the bump is pushed, but the GitHub release failed. After fixing gh, run 'just release_publish'." >&2; exit 1; }
    echo "Released $(jq -r .version package.json). The bump is committed and pushed on this branch. Open a PR."
