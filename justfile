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
build-config dir="" *flags="": install_deps
    node tools/build-config/cli.ts {{dir}} {{flags}}

# Real key presses in a nested session, about a minute. Needs SHADOW_SH, the nested-session driver script.
key-test: build
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${SHADOW_SH:-}" ]; then
        echo "key-test needs SHADOW_SH: a script that runs 'up|spawn|keys|down <name>' in a nested, invisible compositor." >&2
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
