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
| Task checklists                      | [`docs/tasks.md`](docs/tasks.md)                       |

If code and the design disagree, stop and ask the maintainer. Do not change the design to match the code without the maintainer's approval.

## Architecture rules

- Define each command once, in the registry. Keymaps, the command line, help and which-key reference commands and never define behavior.
- Check args only in the one validator. Keys, the command line, the native host and snippets all pass through it.
- Keep the content script within the size guard and admission rule in "Content script size", with no runtime dependency. Load anything else on first use.
- Do not evaluate strings. Snippets from the user's own config are the only exception.
- Give the native host a fixed set of verbs. Never add a shell or eval verb.
- Put no test hooks in `src/`. Tests drive the extension through its public surface. The one exception is the `data-desertfox-tree-read-ms` attribute on the document element, which the key test reads as the signal that the content script is ready.
- Keep no state only in memory. Store it, so a later move to Manifest V3 stays small. A copy of stored state may sit in memory when it refills from storage and drops on `storage.onChanged` (see `src/background/keymap_source.ts`).
- Set each command line name by hand. Never derive it from the id. The registry rejects duplicate names.
- Express flags that exclude each other as one `enum` param with preset flags. `when`, the conditional `default`, `value_when` (which values of an enum a sibling's value allows) and `pattern_arms` (which text pattern a string takes per sibling value) are the only conditions; the last three reuse the syntax of `when`. Split a command that needs more.
- Keep every static argument rule in the param schema, checked by the one validator. A command handler reports runtime failures only, never a bad argument value. Throw runtime failures as `RuntimeRefusal`. A test fails when a handler refuses args the schema accepts.

## Content script size

`content.js` loads in every frame of every page. Docs: [`docs/design.md`](docs/design.md), "Content script size".

- Admission rule: code goes in `content.js` only if one of these holds. Everything else goes in an on-demand bundle.
  - It runs before the first key or decides what happens to a key.
  - It serves a key pressed on most pages in most frames (scrolling).
  - The bundles need it to load (the bundle host and its proxies).
  - It must work while the page navigates, when a bundle injection can go unanswered: `xp` (`page.stop`) and `<A-,>` (`focus_page`) matter most on a loading page. A command that only needs a loaded page does not qualify.
- Guard: 19 KB (19456 bytes) in `MAX_BYTES["content.js"]` of `tools/build.mjs`. The build fails above it.
- Ceiling: 32 KB (32768 bytes), `CONTENT_CEILING_BYTES`. The build fails when the guard is set above it. Size does not delay the first key below about 64 KB, so the ceiling bounds the memory cost (about 2.4 KB of heap per KB, in every frame).
- Raise the guard only as the last step: the new code passes the admission rule (the commit names the clause), code that fails the rule has moved out first, the step is 512 bytes, and the commit names the feature. Passing the ceiling needs the maintainer's decision and a fresh run of `tools/measure/`.

## Public repo rules

This repository is public.

- Do not name other vim-style browser extensions in code, docs, commits or PRs. The one exception is `README.md`, which can name them in a sourced, factual comparison and in its intro. Do not copy their code, because copied code brings its license with it.
  - Carve-out: `tools/measure/rivals/` names the rival extensions it benchmarks (store ids, version pins, hint selectors). The owner approved this for that folder only. Every other file, the `just` recipe name and commit and PR text outside that folder keep the rule.
- Never commit private config or personal data, for example personal site helpers or snippets.
- Never assume a personal toolset (Oasis, Hyprland, a particular terminal). Oasis features stay optional behind the native host.

## Code style

- Carry meaning in names. Comment only what a name cannot say: why this approach, a skipped obvious option, a trap.
- Put the reasoning behind a change in the commit message, not in a comment.
- The build shortens every object property whose name ends in `_`, in every bundle (background, help, popup and newtab included). Use the suffix only on a property that never leaves the extension scripts. Never put it on a name that crosses storage, a message or the native host. Never put it on a name in the DOM, the manifest, CSS, a page or browser API, or JSON. Do not put it on variables, functions or parameters. One exception: a variable or parameter that feeds a shorthand property, or comes from a destructure, keeps the suffix, because it shares the property's name.
- Never leave a promise floating: `await` it, or put `void` before it when its result is not needed. The lint (`no-floating-promises`, `no-misused-promises`, src and tools) fails otherwise. Never write a silent `.catch` inline (the lint warns, `no-restricted-syntax`). Name the reason with a helper from `src/shared/swallow.ts`: `ignore_refusal` for a refusal the browser is expected to give (stale tab, window or container id), `best_effort` for a message to a tab or frame that may have no listener, `keep_chain` for a queue tail whose real error reaches the caller, `refused_as(promise, fallback)` for a read with a stated fallback, and `warn_and_go(label)` as the handler where our own bug could hide.
- Do not use emoji in code.

## Commands

```bash
just build       # bundle the extension
just test        # docs, themes, settings defaults and setting completion checks, the promise lint (`npm run lint`), then unit tests: registry, parser, prefix tree, config merge, and the Python host tests
just docs-gen    # regenerate the tables in docs/keymap.md
just themes      # regenerate src/shared/themes.ts from themes/*.toml, then src/shared/setting_completion.ts
just settings-defaults  # regenerate src/shared/default_settings.ts from src/shared/settings_table.ts and src/shared/setting_completion.ts from src/shared/settings_schema.ts
just host-test   # Python unit tests of the native host and install.sh, with a temporary HOME and a stubbed curl
just key-test    # real key presses in a nested Hyprland, about 34 s on 8 shards, one run at a time (the recipe takes /tmp/desertfox-key-test.lock itself, so never wrap it in `flock`)
just key-test-flakes [n=10]    # loop key-test n times and append one line to ~/.local/state/desertfox/key-test-flakes.jsonl; run it when you suspect a flaky test
just test-all    # `just test` and `just key-test` at once, about as long as key-test alone; exit 1 if either fails
just sign        # sign as unlisted on addons.mozilla.org
just install     # install through the Firefox policy file (needs sudo)
just release     # from a clean non-main branch: bump the patch version, sign and install, commit and push the bump, create the GitHub release that carries the native host, skip the install on a machine whose policy follows the beta, and leave the beta to the nightly after the release PR merges (needs a logged-in gh), reading the AMO key from rbw when unset
just beta        # build main as pushed and publish it as a beta: start the CI beta workflow on main and watch its run (needs a logged-in gh); run it after a release PR merges to get the matching beta at once, as the nightly builds it a day later; a failed run is started again, not rerun
just release_beta # CI only: the beta in src/manifest.json (stamp it first with tools/stamp_beta_manifest.ts): `release_beta_build` (hash the hosts, build), sign, then create the prerelease with the xpi; CI runs those as separate jobs; never bumps or writes package.json; RELEASE_DRY_RUN=1 skips sign and release
just install-profile <dir>  # install into one Firefox profile directory
just build-config [dir]     # lint the user config (writes nothing Firefox reads; apply an edit with `config.reload`, see tools/build-config/README.md)
```

After `just build`, reload the add-on in Firefox. A rebuilt `dist/` under a loaded add-on runs old and new scripts together.

Reproduce a visual bug and record it, at 60 fps so flicker shows, before you ask the maintainer or build a fix.

`docs/keymap.md` is generated between its markers from `src/background/default_keymap.ts` and `docs/keymap_planned.toml` (keys that are `later` or `dropped`). Edit those two, then run `just docs-gen`. `just test` fails when the doc is stale.

Run `just test` before every commit. Run `just key-test` after a change to keys, modes, the content script or config reload. `just test-all` runs both at once. It needs labwc, Hyprland, dbus-daemon and python3. `test/key/session.mjs` starts the nested session. It runs on demand only. Read [`test/key/README.md`](test/key/README.md) before you run it.

While building, run `just key-test-changed [base]` or set `KEY_TEST_PIECES`, not the full suite. Run one full `just key-test` before you report. Run the serial reverse run (`KEY_TEST_ORDER=reverse`) only when the shared test machinery changes: the harness, run, session, server or keyboard files in `test/key/`.

## Planning

`.plans/` holds the trackers for work in progress and `.logs/` holds evidence: check output, review notes, PR bodies. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them. A status goes into the docs. A decision's reason goes beside the code it explains.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`.
- Put worktrees under `/home/roberth/Development/personal/desertfox-worktrees/`.
