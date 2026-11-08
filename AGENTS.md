# AGENTS.md

Guidance for coding agents in this repository. `CLAUDE.md` points here. Keep the content in this file.

## Overview

DesertFox is a keyboard-first Firefox extension built around one command registry. Every command is defined once, and keys, the command line, completion, help and which-key all read that definition. It works on its own. Oasis Dots integration is optional, through a native host.

DesertFox has no official release and no users yet, so a breaking change costs nothing. Choose the best long-term design, not the cheap migration. This rule ends at the first official release.

## Where to look

Read the design for an area before you change it. Read a folder's README before you change or research code in that folder.

| Topic                                | File                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| Architecture, config, scope, roadmap | [`docs/design.md`](docs/design.md)                     |
| The default keys, generated          | [`docs/keymap.md`](docs/keymap.md)                     |
| Measured Firefox behavior            | [`docs/firefox-behavior.md`](docs/firefox-behavior.md) |
| Code map, one line per source folder | [`src/README.md`](src/README.md)                       |

If code and the design disagree, stop and ask the maintainer. Do not change the design to match the code without the maintainer's approval.

## Architecture rules

- Define each command once, in the registry. Keymaps, the command line, help and which-key reference commands and never define behavior.
- Check args only in the one validator. Keys, the command line, the native host and snippets all pass through it.
- Keep the content script under 16 KB minified, with no runtime dependency. Load anything bigger on first use.
- Do not evaluate strings. Snippets from the user's own config are the only exception.
- Give the native host a fixed set of verbs. Never add a shell or eval verb.
- Put no test hooks in `src/`. Tests drive the extension through its public surface.
- Keep no state only in memory. Store it, so a later move to Manifest V3 stays small.
- Set each command line name by hand. Never derive it from the id. The registry rejects duplicate names.
- Express flags that exclude each other as one `enum` param with preset flags. `when`, the conditional `default` and `value_when` (which values of an enum a sibling's value allows) are the only conditions; the last two reuse the syntax of `when`. Split a command that needs more.
- Keep every static argument rule in the param schema, checked by the one validator. A command handler reports runtime failures only, never a bad argument value. Throw runtime failures as `RuntimeRefusal`. A test fails when a handler refuses args the schema accepts.

## Public repo rules

This repository is public.

- Do not name other vim-style browser extensions in code, docs, commits or PRs. The one exception is `README.md`, which can name them in a sourced, factual comparison and in its intro. Do not copy their code, because copied code brings its license with it.
- Never commit private config or personal data, for example personal site helpers or snippets.
- Never assume a personal toolset (Oasis, Hyprland, a particular terminal). Oasis features stay optional behind the native host.

## Code style

- Carry meaning in names. Comment only what a name cannot say: why this approach, a skipped obvious option, a trap.
- Put the reasoning behind a change in the commit message, not in a comment.
- Do not use emoji in code.

## Commands

```bash
just build       # bundle the extension
just test        # old-name, docs, themes, settings defaults and setting completion checks, then unit tests: registry, parser, prefix tree, config merge, and the Python host tests
just docs-gen    # regenerate the tables in docs/keymap.md
just themes      # regenerate src/shared/themes.ts from themes/*.toml, then src/shared/setting_completion.ts
just settings-defaults  # regenerate src/shared/default_settings.ts from src/shared/settings_table.ts and src/shared/setting_completion.ts from src/shared/settings_schema.ts
just host-test   # Python unit tests of the native host and install.sh, with a temporary HOME and a stubbed curl
just key-test    # real key presses in a nested Hyprland, about 34 s on 8 shards, one run at a time (the recipe takes /tmp/desertfox-key-test.lock itself, so never wrap it in `flock`)
just sign        # sign as unlisted on addons.mozilla.org
just install     # install through the Firefox policy file (needs sudo)
just release     # from a clean non-main branch: bump the patch version, sign and install, commit and push the bump, create the GitHub release that carries the native host (needs a logged-in gh), reading the AMO key from rbw when unset
just install-profile <dir>  # install into one Firefox profile directory
just build-config [dir]     # compile the user config into the LIVE managed storage config (trial runs: the CLI with --out, see tools/build-config/README.md)
```

After `just build`, reload the add-on in Firefox. A rebuilt `dist/` under a loaded add-on runs old and new scripts together.

Reproduce a visual bug and record it, at 60 fps so flicker shows, before you ask the maintainer or build a fix.

`docs/keymap.md` is generated between its markers from `src/background/default_keymap.ts` and `docs/keymap_planned.toml` (keys that are `later` or `dropped`). Edit those two, then run `just docs-gen`. `just test` fails when the doc is stale.

Run `just test` before every commit. Run `just key-test` after a change to keys, modes, the content script or config reload. It needs labwc, Hyprland, dbus-daemon and python3. `test/key/session.mjs` starts the nested session. It runs on demand only. Read [`test/key/README.md`](test/key/README.md) before you run it.

While building, run `just key-test-changed [base]` or set `KEY_TEST_PIECES`, not the full suite. Run one full `just key-test` before you report. Run the serial reverse run (`KEY_TEST_ORDER=reverse`) only when the shared test machinery changes: the harness, run, session, server or keyboard files in `test/key/`.

## Planning

`.plans/` holds the trackers for work in progress and `.logs/` holds evidence: check output, review notes, PR bodies. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them. A status goes into the docs. A decision's reason goes beside the code it explains.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`.
- Put worktrees under `/home/roberth/Development/personal/desertfox-worktrees/`.
