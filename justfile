default:
    @just --list

# Regenerate the binding tables in docs/keymap.md from the default keymap.
docs-gen: install_deps
    npm run --silent docs:gen

# Regenerate src/shared/themes.ts from themes/oasis/*.css and themes/*.toml.
themes: install_deps
    npm run --silent themes:write

# Copy the Oasis theme CSS files from an oasis.nvim checkout into themes/oasis/, then regenerate src/shared/themes.ts.
oasis-themes oasis_nvim_dir: install_deps
    npm run --silent themes:copy -- {{quote(oasis_nvim_dir)}}
    npm run --silent themes:write

# Typecheck, then bundle the extension into dist/.
build: install_deps
    npm run --silent typecheck
    npm run --silent build

# Check no old-name tokens remain, docs/keymap.md and src/shared/themes.ts are current, then run the unit tests from TypeScript source by Node's type stripping.
test: install_deps
    #!/usr/bin/env bash
    set -euo pipefail
    # A test that runs away dies with its scope, so nothing outlives the run.
    if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 true >/dev/null 2>&1; then
        exec systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p RuntimeMaxSec=900 npm run --silent test
    fi
    echo "test: no systemd user session, so this run has no memory cap or time limit." >&2
    exec npm run --silent test

[private]
install_deps:
    @test -d node_modules || npm install --no-audit --no-fund

# Merge the config directory (default ~/.config/desertfox) into the live managed storage file. Extra flags (such as --schemas) go to the CLI. For another output path run the CLI with --out.
build-config dir="" *flags="": build
    node tools/build-config/cli.ts {{ if dir == "" { "" } else { quote(dir) } }} --live {{flags}}

# Real key presses in a nested session, about a minute. Needs SHADOW_SH, the nested-session driver script.
key-test: build
    #!/usr/bin/env bash
    set -euo pipefail
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
        echo "release found changes only in package.json, package-lock.json and src/manifest.json. That may be a bump left by a failed sign or install. Run 'git diff HEAD -- package.json package-lock.json src/manifest.json'. If it shows only the version line, run 'git checkout -- package.json package-lock.json src/manifest.json' and rerun. Otherwise commit or keep your edits. If signing succeeded, commit the bump instead." >&2
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

# Bump the patch version, sign dist/ and install it for every profile. Fills the AMO key from rbw when either variable is empty. Needs a clean release branch.
release:
    #!/usr/bin/env bash
    set -euo pipefail
    just release_guard
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
    echo "Released $(jq -r .version package.json). Commit the bump on this branch and open a PR."
