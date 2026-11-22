# Task checklists

The files to touch for the most common changes, in order. Each list comes from a real commit. Read the README of each folder you touch and the matching file under `docs/design/` (the map is [`design.md`](design.md)). Checks for every task: `just test`, `just build` (it checks the size guards, which `just test` does not), then `just key-test-changed`.

## Add a command

Example: `copy.tabs`, commit `c6c5ec6b`.

1. Add or extend a module in `src/commands/`. Call `define` with the id, label, intent and params. Recipe: [`src/commands/README.md`](../src/commands/README.md).
2. Import a new module in `src/background/command_modules.ts`.
3. Bind a default key in `src/shared/keys/default_keymap.ts`, if the command has one.
4. Run `just docs-gen`. It rewrites [`keymap.md`](keymap.md).
5. Add a test in `test/commands/`, and the command's id and command line name to the list in `test/commands/flags.test.ts`.
6. Put each new `src/` file in a glob of `test/key/areas.mjs`. `test/key/areas.test.ts` fails on a file no glob covers.
7. Add a key-test piece only when the command changes what a key does in Firefox. See [`test/key/README.md`](../test/key/README.md).
8. Describe the command in [`design/registry.md`](design/registry.md) where the design lists its group.

## Add a setting

Example: `toast_ms`, commit `2ad2c9ed`.

1. Add one row to `src/shared/settings_table.ts`: kind, values and default. The `Settings` type follows from it.
2. Add its editor text to `src/shared/settings_docs.ts`.
3. Run `just settings-defaults`. It rewrites `src/shared/default_settings.ts` and `src/shared/setting_completion.ts`. Never edit them.
4. Add the setting to `EXPECTATIONS` and `ACCEPTS` in `test/settings_contract.test.ts`.
5. Read the value where the feature runs. Content code takes it from the compiled keymap (`src/shared/prefix_tree.ts`, `src/shared/keys/compiler.ts`). Name the new field in the `CompiledKeymap` type in `src/shared/prefix_tree.ts` and in the test fixtures that build a compiled keymap by hand. Raise `COMPILED_KEYMAP_VERSION` in the same file, so a stored tree of the old shape is recompiled. Do not import `settings_schema.ts` in the content script or the command line page.
6. Add the setting to the settings table in [`design/config.md`](design/config.md).
7. A setting that needs state kept apart from the config writes through `create_write_queue` in `src/background/store_turns.ts`, as `src/background/previous_tab.ts` and `src/background/window_focus.ts` do. Never hand-roll a queue.

## Add a hint action

Example: the `prompt` action, commit `f51dcc82`.

1. Add the action in `src/content/hints/actions.ts`. A larger action gets its own file in `src/content/hints/`, as `prompt_line.ts` does. Wire the pick in `src/content/hints/main.ts`.
2. In `src/commands/hint.ts`, add the action to `values`, `value_when` (the condition that allows it), `short`, `value_labels` and `description` of the action param, and to the intent text. Add a case to `test/registry/value_when.test.ts`.
3. Bind a key in `src/shared/keys/default_keymap.ts`, then run `just docs-gen`.
4. Add unit tests in `test/hints/`, and a case in `test/key/p6_hints.mjs`. Add one in `test/key/p6_frames.mjs` when the action behaves differently in a frame.
5. Run `just build`. It fails when `content.js` passes its size guard. Hint code lives in the on-demand `hints` bundle, so keep it out of `content.js`: see "Content script size" in [`AGENTS.md`](../AGENTS.md).
6. In [`src/content/hints/README.md`](../src/content/hints/README.md), add a bullet for a new file and extend the `actions.ts` entry.

## Add a bundle

Example: the `tree` bundle, commit `f7c3b478`.

1. Add the name to `BUNDLE_NAMES` in `src/shared/bundles.ts`, in the order the build should run them (the shared mangle cache makes the order change the bytes), and one sentence about it in the comment above. A name that is a bundle needs `src/content/<name>/main.ts`: `tools/build.mjs` derives the entry from the name. Only `cmdline` is an exception (`src/cmdline/host.ts`).
2. Register each handler in `main.ts` with `register_handler_`. A command of the bundle needs the `bundle` field and no `run`. The command side (the `define` entry in `src/commands`, the default key, the tests and the key test) follows "Add a command" above. `test/commands/lazy_bundle.test.ts` fails when the bundle does not register the command's id.
3. Run `just build`, then read the size of `dist/<name>.js` with `wc -c`. The build writes every bundle, but its size line lists only the files that have a `MAX_BYTES` entry, so a new bundle shows no size there. Then add one line to `MAX_BYTES` in `tools/build.mjs`: the measured size plus headroom, and a comment on when the bundle loads. `test/bundles.test.ts` fails on a name with no line.
4. Put `src/content/<name>/**` in a glob of `test/key/areas.mjs`.
5. Add `src/content/<name>/README.md`, a line in `src/content/README.md` and the folder line in `src/README.md`.
6. Describe the bundle in [`design/bundles.md`](design/bundles.md) where it lists the bundles.
7. Run `just build` again. The size line now shows the new file against its guard. Keep out of `content.js` everything the admission rule does not admit.

## Add a site row

Example: the Kagi and Brave image rows, commit `49dab910`.

1. Add the name to `DEFAULT_SITE_ROW_NAMES` in `src/shared/table_constants.ts`. A site with several address forms shares one name across rows.
2. Add the row in `src/background/default_site_rows.ts`: the addresses, then `bind`, `pass`, `keymap` or the page settings it changes.
3. Update the list of names in `default_site_rows_off` in `src/shared/settings_docs.ts`, and in the expected text of `test/settings_contract.test.ts` (two places).
4. Run `just settings-defaults`. It rewrites `src/shared/setting_completion.ts`.
5. Run `just docs-gen`. It rewrites [`site_rows.md`](site_rows.md).
6. Update the row names and counts in `test/page_keymap.test.ts`, and add a case to `test/site_item.test.ts` when the row sets item mode landings.
7. Add a unit test of the row, with a fixture page under `test/fixtures/` when it reads page structure, and a key test piece when it changes what a key does in Firefox. See [`test/key/README.md`](../test/key/README.md).
8. Describe the row in [`design/config.md`](design/config.md) where it lists the shipped rows.

## Raise a guard

The guards are the `MAX_BYTES` entries in `tools/build.mjs`. The rule for `content.js` is in [`AGENTS.md`](../AGENTS.md), "Content script size". Raise another bundle's guard only when its feature needs the room, and name the feature in the commit.

1. Check the code against the admission rule first. Code that fails it moves to an on-demand bundle, and that is the fix. List each new `content.js` source in `test/content_sources.ts` with its clause.
2. Raise the `content.js` guard as the last step, by 512 bytes, never past `CONTENT_CEILING_BYTES` (32 KB). The ceiling needs the maintainer's decision and a fresh run of `tools/measure/`.
3. The commit names the admission clause and the feature.
4. Run `just build`. It fails above any guard.
