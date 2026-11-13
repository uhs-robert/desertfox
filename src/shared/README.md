# shared

Types and constants that fix the hand-off formats between the background page, the content script and `tools/build-config`. Apart from `registry/`, `keys/`, `theme/`, `config_build/` and `match_pattern.ts`, this folder holds no logic. Every other source folder may import from it, and it imports from none of them.

- `command.ts`: a command definition, and the `commands.json` entry cut from it.
- `invocation.ts`: the `Invocation` every caller produces, and a key binding.
- `keymap.ts`: keymap data as written by the user.
- `prefix_tree.ts`: the compiled keymap stored in `storage.local` for the content script. Its `format_version` is bumped when the shape changes, and `current_keymap` hides an older one until the background recompiles at its next start. A `SiteRule` holds its `bind` as normalized key to tokens and leaf.
- `messages.ts`: messages between content script and background.
- `relay.ts`: the handlers a frame may ask the background to run in another frame of its tab (`relay` message), each with its bundle and direction: to the top frame, or to a frame named by id. The background adds the sender's `from_frame`.
- `container_store.ts`: the name and cookie store id of the container-less store, shared by the background and the `open` commands.
- `group_name.ts`: the label of a native tab group (its title, or title plus `#id` when empty or shared) and the lookup of a typed label.
- `tab_model_port.ts`: the port names of the live tab model, the plain one and its `:normal` and `:private` forms.
- `folder_pick.ts`: `pick_by` (exact key, then best fuzzy match, a tie refused), `pick_folder` (the filing rule for a folder path), `in_folder` and `rows_in_folder` (the subtree test). The `bookmark` handlers and the command line page share them, so a typed `--folder=` filters by the rule that filing uses.
- `mark_names.ts`: the local mark keys (`a-z`, and `'` or the backtick for the previous position), the limits of the mark store and the one rule that cuts the hash off a page address.
- `mark_text.ts`: the text of a mark or quickmark in a list (address without scheme, scroll offset), which the which-key rows and the command line list share.
- `quickmark_names.ts`: the quickmark key rule (one letter or digit), the address cap and the `QuickmarkTable` type.
- `media.ts`: the messages between the background and the `media` bundle, the media actions and the step rules of speed, volume and seek.
- `bundles.ts`: the names of the scripts loaded on first use, and which mode loads which.
- `page_bundle_tag.ts`: the extension pages' side of a bundle load. `listen_for_bundle_requests` adds a bundle's `<script src>` tag when the background asks, joins repeat asks and answers after the script has run.
- `registry/`: the command registry, the one validator and the command line parser. See its README.
- `engines/`: search engines as URL templates with slots, and the tree resolver. Outside the barrel. See its README.
- `keys/`: key notation, the prefix tree compiler and the matcher. See its README.
- `theme/`: the public role list (`roles.ts`), the table that fills missing roles (`derive.ts`), the theme file check (`theme_file.ts`), the CSS token names (`tokens.ts`), the theme lookup from the `palette` name (`load.ts`, background only) and the stored theme as CSS (`apply.ts`, for pages and lazy bundles, with the `desertfox_theme` and `desertfox_user_css` storage keys). User CSS must name a surface's inner class: variables on `:root` or `:host` do not reach inside. The extension build and `tools/build-config` share them.
- `config_build/`: the pure config build. It takes raw file text keyed by relative path and the command list, then merges, parses snippets and key bindings, and checks everything. It uses no Node API, so the extension and `tools/build-config` share it. Only the background may import it, because it pulls in `smol-toml` and `themes.ts`. See its README.
- `swallow.ts`: one helper per reason an error is dropped: `ignore_refusal`, `best_effort`, `keep_chain`, `refused_as(promise, fallback)` and the handler `warn_and_go(label)`, which logs. They replace an inline silent `.catch`, which the `no-restricted-syntax` lint rule in `eslint.config.mjs` flags. The content script imports it, so keep it free of classes and strings.
- `zip.ts`: `read_zip` and `write_zip` for config export and import. The reader takes stored and deflated entries and returns a path-to-text map. It skips `__MACOSX/` and dot-file entries and drops `.` path segments. It fails the whole archive on an unsafe path (absolute, `..`, backslash), an exact duplicate, a symlink, overlapping entries, a size or count overrun, a bad checksum or text that is not UTF-8. `read_folder` puts a folder the page read (`webkitdirectory`) through the same path, junk, duplicate, count and size rules. The writer is store-only. The byte caps (1 MiB) equal the host's reply cap. Pure, so the background and help pages can both use it.
- `storage_watch.ts`: `watch_stored` (a `storage.local` key, now and at each change), `touches_settings` (a `storage.onChanged` event that says the settings in force changed: a write of the config status key `CONFIG_STATUS_STORAGE_KEY`, which every settings edit ends with, or of `FILES_CONFIG_STORAGE_KEY`, the last write of a reload) and `follow_settings`. Pages use `follow_settings(draw)` to redraw from the current settings: it calls `draw(true)` at once and `draw(false)` at each change, one at a time, and puts the scroll position and focus back after each redraw. The page keeps its own timers and listeners out of the DOM and stops the old ones in `draw`.
- `permission_grant.ts`: the optional permissions a Help panel grants, the manifest permissions behind each, the `#grant/<permission>` hash and the refusal hint.
- `native_host.ts`: the host name, the `nativeMessaging` permission, `host_channel` (a development install follows `main`, any other build its own version) `install_hashes_of` (reads `host_sha256.json`), and the two one-line install commands the Help panel shows: checked against the signed build for a release, unchecked from `main` otherwise.
- `themes.ts`: generated by `just themes` from `themes/oasis/*.css` and the repo `themes/*.toml`, every role filled. It packs each color set as an array in role order and holds about 26 KB, so only the background imports it. Do not edit.
- `match_pattern.ts`: WebExtension match patterns. The background imports the parser. Snippet `matches` use `matches_pattern`, and each `site_rules` row compiles to one regex source (`regex` of a `SiteRule` in the compiled keymap) that the background tests with `matches_any_address` against the sender's address (`page_keymap.ts`). It also holds the site table's column rules: `site_row_columns` splits a row into its `off`, key rule and per-site values, and `resolve_site_columns` lets the first matching row that sets a column decide it. `bind` is the one column that merges key by key. The compiler, the background and the popup share them.
- `layers.ts`: the `z-index` of each surface the content script draws, bottom to top: hints, mode badge, toast, which-key panel, command line.
- `config.ts`: the merged config file and the settings in force. `apply_edits` puts the saved and then the temp browser edits over the config's settings.
- `settings_table.ts`: every setting as one row of data, its kind, values and default. The `Settings` type follows from it. Start here to add a setting.
- `settings_schema.ts`: what each setting accepts, derived from its table row. The build tool and `set` share it. The content script and the command line page must not import it.
- `settings_docs.ts`: the editor description of each setting, for `tools/build-config` only.
- `setting_completion.ts`: generated by `just settings-defaults` from the schema, one row per setting with its name, flags, expectation and listed values. The command line page reads it instead of the schema. Do not edit.
- `default_settings.ts`: generated by `just settings-defaults` from the table, one constant per setting. Do not edit.

The content script imports only types and `prefix_tree.ts` from here, so the 17 KB bundle stays small.
