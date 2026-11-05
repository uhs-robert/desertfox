# AGENTS.md

Guidance for coding agents in this repository. `CLAUDE.md` points here. Keep the content in this file.

## Overview

OasisFox is a keyboard-first Firefox extension built around one command registry. Every command is defined once, and keys, the command line, completion, help and which-key all read that definition. It works on its own. Oasis Dots integration is optional, through a native host.

## Where to look

Read the design for an area before you change it. Read a folder's README before you change or research code in that folder.

| Topic                                  | File                                     |
| -------------------------------------- | ---------------------------------------- |
| Architecture, config, scope, roadmap   | [`docs/design.md`](docs/design.md)       |
| The default keys, generated            | [`docs/keymap.md`](docs/keymap.md)       |
| Measured Firefox behavior              | [`docs/spike.md`](docs/spike.md)         |
| Code map, one line per source folder   | [`src/README.md`](src/README.md)         |
| The phase 0 test harness               | `spike/` (throwaway, do not build on it) |

If code and the design disagree, stop and ask the maintainer. Do not change the design to match the code without the maintainer's approval.

## Architecture rules

- Define each command once, in the registry. Keymaps, the command line, help and which-key reference commands and never define behavior.
- Check args only in the one validator. Keys, the command line, the native host and snippets all pass through it.
- Keep the content script under 16 KB minified, with no runtime dependency. Load anything bigger on first use.
- Do not evaluate strings. Snippets from the user's own config are the only exception.
- Give the native host a fixed set of verbs. Never add a shell or eval verb.
- Keep no state only in memory. Store it, so a later move to Manifest V3 stays small.
- Set each command line name by hand. Never derive it from the id. The registry rejects duplicate names.
- Express flags that exclude each other as one `enum` param with preset flags. `when` is the only condition. Split a command that needs more.

## Public repo rules

This repository is public.

- Do not name other vim-style browser extensions in code, docs, commits or PRs. Do not copy their code, because copied code brings its license with it.
- Never commit private config or personal data, for example personal site helpers or snippets.
- Never assume a personal toolset (Oasis, Hyprland, a particular terminal). Oasis features stay optional behind the native host.

## Code style

- Carry meaning in names. Comment only what a name cannot say: why this approach, a skipped obvious option, a trap.
- Put the reasoning behind a change in the commit message, not in a comment.
- Do not use emoji in code.

## Commands

```bash
just build       # bundle the extension
just test        # docs and themes check, then unit tests: registry, parser, prefix tree, config merge
just docs-gen    # regenerate the tables in docs/keymap.md
just themes      # regenerate src/shared/themes.ts from themes/*.toml
just key-test    # real key presses in a nested Hyprland, about a minute
just sign        # sign as unlisted on addons.mozilla.org
just install     # install through the Firefox policy file (needs sudo)
just release     # from a clean non-main branch: bump the patch version, sign and install, reading the AMO key from rbw when unset
just install-profile <dir>  # install into one Firefox profile directory
just build-config [dir]     # compile the user config into the managed storage config
```

`docs/keymap.md` is generated between its markers from `src/background/default_keymap.ts` and `docs/keymap_planned.toml` (keys that are `later` or `dropped`). Edit those two, then run `just docs-gen`. `just test` fails when the doc is stale.

Run `just test` before every commit. Run `just key-test` after a change to keys, modes, the content script or config reload. It needs a nested Hyprland and runs on demand only. Key tests can run in parallel from different worktrees, with no lock: each run has its own shadow session and clears the ones that dead runs left. Do not run two from one worktree, because each `just key-test` rebuilds and clears that worktree's `dist/`. `KEY_TEST_ONLY=<regex>` runs only the cases whose name matches, plus the cases marked `{ setup: true }` in `test/key/`, which leave state that later cases read. The output tags those as `SETUP`.

## Planning

`.plans/<topic>/<topic>.md` holds the tracker for work in progress, with its plan drafts beside it. `.logs/<topic>/` holds evidence: check output, review notes, PR bodies. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them. A status goes into the docs. A decision's reason goes beside the code it explains.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`.
