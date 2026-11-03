default:
    @just --list

# Typecheck, then bundle the extension into dist/.
build: install_deps
    npm run --silent typecheck
    npm run --silent build

# Unit tests, run from TypeScript source by Node's type stripping.
test: install_deps
    npm run --silent test

[private]
install_deps:
    @test -d node_modules || npm install --no-audit --no-fund

# Merge the config directory (default ~/.config/oasisfox) into the managed storage file.
build-config dir="" *flags="": build
    node tools/build-config/cli.ts {{ if dir == "" { "" } else { quote(dir) } }} {{flags}}

# Real key presses in a nested session, about a minute. Needs SHADOW_SH, the nested-session driver script.
key-test: build
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${SHADOW_SH:-}" ]; then
        echo "key-test needs SHADOW_SH: a script that runs 'up|spawn|keys|down <name>' in a nested, invisible compositor (optional: 'status', one '<name>: up|down ...' line per session). Cleanup of killed runs works only for drivers that keep sessions in /tmp/shadow-<uid>-<name>." >&2
        exit 2
    fi
    node test/key/run.mjs

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
    cp "${xpis[0]}" "{{profile_dir}}/extensions/oasisfox@uhs-robert.xpi"
    echo "installed {{profile_dir}}/extensions/oasisfox@uhs-robert.xpi"

# Install the signed add-on for every profile through Firefox's policy file. Needs sudo and jq.
install:
    bash tools/install_policy.sh

# Entry in the rbw vault that holds the AMO key: the secret as password, the issuer in the notes.
export AMO_RBW_ENTRY := env("AMO_RBW_ENTRY", "Firefox AMO API Key")

# Sign dist/ and install it for every profile. Fills the AMO key from rbw when either variable is empty.
release:
    #!/usr/bin/env bash
    set -euo pipefail
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
    just sign
    just install
