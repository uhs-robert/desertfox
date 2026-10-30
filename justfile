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
