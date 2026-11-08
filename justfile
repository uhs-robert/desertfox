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

# Check no old-name tokens remain, docs/keymap.md, src/shared/themes.ts, src/shared/default_settings.ts and src/shared/setting_completion.ts are current, then run the unit tests from TypeScript source by Node's type stripping, and the Python host tests.
test: install_deps
    #!/usr/bin/env bash
    set -euo pipefail
    # A test that runs away dies with its scope, so nothing outlives the run. The host tests share the scope and its time limit.
    all_tests='just host-test && npm run --silent test'
    if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 true >/dev/null 2>&1; then
        exec systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 bash -c "$all_tests"
    fi
    echo "test: no systemd user session, so this run has no memory cap or time limit." >&2
    exec bash -c "$all_tests"

[private]
install_deps:
    @test -d node_modules || npm install --no-audit --no-fund

# Merge the config directory (default ~/.config/desertfox) into the live managed storage file. Extra flags (such as --schemas) go to the CLI. For another output path run the CLI with --out.
build-config dir="" *flags="": build
    node tools/build-config/cli.ts {{ if dir == "" { "" } else { quote(dir) } }} --live {{flags}}

# Python unit tests of the native host and its install script. The install tests use a temporary HOME and a stubbed curl.
host-test:
    python3 -m unittest discover -s host -p 'test_*.py'

# Real key presses in a nested session. The latest full run took about 8.5 minutes (506 s for 241 cases); the key-test-speed work (#273) brings it down further. Needs SHADOW_SH, or the shadow skill script in dotfiles, as the nested-session driver.
key-test: build
    #!/usr/bin/env bash
    set -euo pipefail
    fallback_driver="$HOME/dotfiles/.claude/skills/shadow/shadow.sh"
    if [ -z "${SHADOW_SH:-}" ] && [ -x "$fallback_driver" ]; then
        export SHADOW_SH="$fallback_driver"
    fi
    if [ -z "${SHADOW_SH:-}" ]; then
        echo "key-test needs SHADOW_SH: a script that runs 'up|spawn|keys|down <name>' in a nested, invisible compositor (optional: 'status', one '<name>: up|down ...' line per session). Cleanup of killed runs works only for drivers that keep sessions in /tmp/shadow-<uid>-<name>." >&2
        exit 2
    fi
    # A test Firefox that runs away would otherwise take the whole tmux window with it: the kernel kills it, and systemd then stops every process in the window's unit. In its own capped scope, only this run dies.
    if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=1800 true >/dev/null 2>&1; then
        exec systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=1800 node test/key/run.mjs
    fi
    echo "key-test: no systemd user session, so this run has no memory cap." >&2
    exec node test/key/run.mjs

# Rewrite test/key/piece_seconds.json, the piece weights that order the sharded key test, from a full-run timings file (default: the newest .logs/key-test-timings-*.json). Run it in the last PR of a change that moves piece run times.
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
    cp host/desertfox-host host/install.sh "$assets/"
    (cd "$assets" && sha256sum desertfox-host > desertfox-host.sha256)
    gh_command=(gh release create "v$version" "$assets/desertfox-host" "$assets/desertfox-host.sha256" "$assets/install.sh" --target "$(git rev-parse HEAD)" --title "v$version" --notes "Native host $version. The extension's :native.install page shows the command that installs it.")
    if [ "${RELEASE_DRY_RUN:-}" = "1" ]; then
        echo "dry run: ${gh_command[*]}"
        cat "$assets/desertfox-host.sha256"
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
