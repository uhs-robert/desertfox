# Task checklists

The files to touch for the three most common changes, in order. Each list comes from a real commit. Read the README of each folder you touch and the matching part of [`design.md`](design.md). Checks for every task: `just test`, then `just key-test-changed`.

## Add a command

Example: `copy.tabs`, commit `c6c5ec6b`.

1. Add or extend a module in `src/commands/`. Call `define` with the id, label, intent and params. Recipe: [`src/commands/README.md`](../src/commands/README.md).
2. Import a new module in `src/background/command_modules.ts`.
3. Bind a default key in `src/background/default_keymap.ts`, if the command has one.
4. Run `just docs-gen`. It rewrites [`keymap.md`](keymap.md). Delete the command's entry from [`keymap_planned.toml`](keymap_planned.toml) if it is listed there.
5. Add a test in `test/commands/`, and the command's id and command line name to the list in `test/commands/flags.test.ts`.
6. Put each new `src/` file in a glob of `test/key/areas.mjs`. `test/key/areas.test.ts` fails on a file no glob covers.
7. Add a key-test piece only when the command changes what a key does in Firefox. See [`test/key/README.md`](../test/key/README.md).
8. Describe the command in [`design.md`](design.md) where the design lists its group.

## Add a setting

Example: `toast_ms`, commit `2ad2c9ed`.

1. Add one row to `src/shared/settings_table.ts`: kind, values and default. The `Settings` type follows from it.
2. Add its editor text to `src/shared/settings_docs.ts`.
3. Run `just settings-defaults`. It rewrites `src/shared/default_settings.ts` and `src/shared/setting_completion.ts`. Never edit them.
4. Add the setting to `EXPECTATIONS` and `ACCEPTS` in `test/settings_contract.test.ts`.
5. Read the value where the feature runs. Content code takes it from the compiled keymap (`src/shared/prefix_tree.ts`, `src/shared/keys/compiler.ts`), Name the new field in the `CompiledKeymap` type in `src/shared/prefix_tree.ts` and in the test fixtures that build a compiled keymap by hand. Raise `COMPILED_KEYMAP_VERSION` in the same file, so a stored tree of the old shape is recompiled. Do not import `settings_schema.ts` in the content script or the command line page.
6. Add the setting to the settings table in [`design.md`](design.md).
7. A setting that needs state kept apart from the config writes through `create_write_queue` in `src/background/store_turns.ts`, as `src/background/previous_tab.ts` and `src/background/window_focus.ts` do. Never hand-roll a queue.

## Add a hint action

Example: the `prompt` action, commit `f51dcc82`.

1. Add the action in `src/content/hints/actions.ts`. A larger action gets its own file in `src/content/hints/`, as `prompt_line.ts` does. Wire the pick in `src/content/hints/main.ts`.
2. In `src/commands/hint.ts`, add the action to `values`, `value_when` (the condition that allows it), `short`, `value_labels` and `description` of the action param, and to the intent text. Add a case to `test/registry/value_when.test.ts`.
3. Bind a key in `src/background/default_keymap.ts`, then run `just docs-gen`.
4. Add unit tests in `test/hints/`, and a case in `test/key/p6_hints.mjs`. Add one in `test/key/p6_frames.mjs` when the action behaves differently in a frame.
5. Run `just build`. It fails when `content.js` passes its size guard. Hint code lives in the on-demand `hints` bundle, so keep it out of `content.js`: see "Content script size" in [`AGENTS.md`](../AGENTS.md).
6. In [`src/content/hints/README.md`](../src/content/hints/README.md), add a bullet for a new file and extend the `actions.ts` entry.
