# shared

Types and constants that fix the hand-off formats between the background page, the content script and `tools/build-config`. Besides types and constants it holds small helpers and the config,
key and registry logic (`registry/`, `keys/`, `theme/`, `config_build/`, `match_pattern.ts`, `score.ts`, `site_key.ts`). Most of it is pure. Some files touch the browser or the DOM, for
example `storage_watch.ts`, `icons.ts` and `theme/apply.ts`. Every other source folder may import from it, and it imports from none of them.

The detail of the long entries is in the "Shared files for ..." sections of these `docs/design/` area files:
`registry.md`, `keys.md`, `bundles.md`, `config.md`, `config_delivery.md`, `host.md`, `interfaces_cmdline.md`, `interfaces_pages.md`.

- `command.ts`: a command definition, and the `commands.json` entry cut from it, plus the value lists that a command and its content handler share.
- `invocation.ts`: the `Invocation` every caller produces, and a key binding.
- `keymap.ts`: keymap data as written by the user.
- `prefix_tree.ts`: the compiled keymap stored in `storage.local` for the content script, with its `format_version` and `current_keymap`.
- `grab_steps.ts`: the grab step ladder (3 to 192 px, doubling), shared by the `grab_step_px` setting and the grab bundle.
- `messages/`: every message by channel: `content.ts`, `page.ts`, `tab.ts`, `ports.ts` and `map.ts` (each request with its answer type).
- `relay.ts`: the handlers a frame may ask the background to run in another frame of its tab (`relay` message), each with its bundle and direction.
- `container_store.ts`: the name and cookie store id of the container-less store, shared by the background and the `open` commands.
- `group_name.ts`: the label of a native tab group (its title, or title plus `#id` when empty or shared) and the lookup of a typed label.
- `tab_model_port.ts`: the port names of the live tab model, the plain one and its `:normal` and `:private` forms.
- `rank_port.ts`: the port between the command line page and the background for the lists that rank the history: request, reply and the `stale` push.
- `folder_pick.ts`: `pick_by`, `pick_folder`, `in_folder` and `rows_in_folder`, the folder filing rule that the `bookmark` handlers and the command line page share.
- `mark_names.ts`: the local mark keys (`a-z`, and `'` or the backtick for the previous position), the limits of the mark store and the one rule that cuts the hash off a page address.
- `mark_text.ts`: the text of a mark or quickmark in a list (address without scheme, scroll offset), which the which-key rows and the command line list share.
- `quickmark_names.ts`: the quickmark key rule (one letter or digit), the address cap and the `QuickmarkTable` type.
- `media.ts`: the messages between the background and the `media` bundle, the media actions and the step rules of speed, volume and seek.
- `bundles.ts`: the names of the scripts loaded on first use, and which mode loads which. Also `MEDIA_PANEL_HANDLER`, the handler id the background sends to `whichkey`.
- `help_route.ts` (in `page/`): the help page ids, the hash parser (`parse_route`) and the help URL builders. The popup, the background, the commands and the help page share it.
- `icon_cache.ts` (in `page/`): the favicon cache in `storage.local` (`favicon_cache`), which the background saver fills and the new tab page reads.
- `storage_keys.ts` (in `config/`): every `storage.local` key the background owns. The keymap key lives in `prefix_tree.ts`, the theme and user CSS keys in `theme/apply.ts`.
- `config_load.ts` (in `config/`): reads the stored config, the setting edits and `build_config_status`. It touches `browser.storage`, so the background and every extension page import it.
- `site/`, `completion/`, `hints/`, `ui/`: pure views, rows and text rules. See their READMEs.
- `copy/`: copy and yank helpers, one of which writes the clipboard. See its README.
- `url_build.ts`: URL math: `openable_url` (the one allow-list for opening an address), `parent_url`, `root_url`, `url_target`, `engine_search_url`, `engine_url`, `own_pages`.
- `page_bundle_tag.ts`: the extension pages' side of a bundle load: `listen_for_bundle_requests` adds the `<script src>` tag when the background asks.
- `registry/`: the command registry, the one validator and the command line parser. See its README.
- `engines/`: search engines as URL templates with slots, and the tree resolver. Outside the barrel. See its README.
- `keys/`: key notation, the prefix tree compiler and the matcher. See its README.
- `theme/`: the theme roles, the base16 reader, the theme lookup (`load.ts`, never imported by a page or content bundle) and the stored theme as CSS. See its README.
- `config_build/`: the pure config build over raw file text. The background runs it. Nothing outside the background imports it at runtime. See its README.
- `page_base.css`: the base sheet of the help and new tab pages: the fallback palette, the type and spacing tokens and the key cap styles, at zero specificity.
- `key_caps.ts`: `key_caps(text)` draws a key sequence as a row of `kbd.desertfox-keycap` caps.
- `icons.ts`: the inline SVG icons the extension pages draw (`chevron_icon`, `menu_icon`, `heart_icon`). The brand mark stays the file `icons/desertfox.svg`.
- `swallow.ts`: one helper per reason to drop an error (`ignore_refusal`, `best_effort`, `keep_chain`, `refused_as`, `warn_and_go`). The content script imports it: keep it free of classes and strings.
- `index.ts`: the barrel of the types and the constants that every folder may import.
- `anything_ref.ts`: the reference a finder row carries to the `anything` command, so the handler acts on the row the list showed and never ranks again.
- `config_file_path.ts`: which paths the files editor may store. The page refuses early and the background decides.
- `config_kinds.ts`: the data kinds of the config folder. It stays apart from `config_build/` so a page can name them without bundling the build.
- `engine_fields.ts`: the checks of the engine form's fields. The page runs them while the user types and the background runs them again at Save.
- `font_candidates.ts`: the built-in font names (`FONT_CANDIDATES`), `probe_fonts`, `canvas_measure` and `merge_font_names`. Extension pages only.
- `host_version.ts`: release versions of the extension and the native hosts, and the check that a host is older than the extension.
- `inspect.ts`: what the background relay and the hints bundle agree on for the Inspector handoff.
- `jump_names.ts`: the limits and the entry of the jump list, shared by its store, its step and the page.
- `load_commands.ts`: fetches `commands.json` for the help and status pages. Not for the content script.
- `media_values.ts`: the value patterns of the `media` actions. Apart from `media.ts` so the `media` bundle does not carry these texts.
- `quality.ts`: the messages between the background and the `quality` bundle.
- `register_names.ts`: the register names and the one check every register user shares.
- `score.ts`: the fuzzy scorer for every completion source. It scores like fzf version 1 and counts a dot as a word break. `rank_top` gives the first rows of `rank` with their scores.
- `send_key_limit.ts`: the most key pairs one `page.send_key` call sends.
- `setting_list.ts`: the settings page's view of every setting: typed value, top layer, kind and allowed values.
- `site_key.ts`: the key that groups tabs of one site. Each subdomain is its own site, so no public suffix list is needed.
- `table_constants.ts`: the constants the settings table reads for its defaults. They sit apart from `config.ts` so the generator can load the table when `default_settings.ts` is missing.
- `theme_names.ts`: every built-in theme name, generated by `tools/build_themes.ts` (`just themes`). It carries no colors.
- `zip.ts`: `read_zip`, `read_folder` and `write_zip` for config export and import. Pure.
- `storage_watch.ts`: `watch_stored`, `touches_settings` and `follow_settings`: how pages follow `storage.local` and redraw from the current settings.
- `permission_grant.ts`: the optional permissions a Help panel grants, the manifest permissions behind each, the `#grant/<permission>` hash and the refusal hint.
- `browser_module_protocol.ts`: the browser module channel: key names, version, fixed command list, message kinds, locked page routes, snapshots, the locked-page key tree and their validators.
- `browser_module_scope.ts`: which keys work on locked pages: the derived command set, the pruned tree for the module and the check of a `run` request.
- `native_host.ts`: the host name, the `nativeMessaging` permission, `host_channel`, `install_hashes_of` and the install commands the Help panel shows.
- `themes.ts`: generated by `just themes`, every role filled. Only the background imports it, because it is large. Do not edit.
- `match_pattern.ts`: WebExtension match patterns and the site table's column rules (`site_row_columns`, `resolve_site_columns`).
- `key_test_build.ts`: `KEY_TEST_BUILD`, true only in the build the key test loads. The page-readable test attributes sit behind it.
- `layers.ts`: the `z-index` of each surface the content script draws, bottom to top: hints, mode badge, toast, which-key panel, command line.
- `config.ts`: the merged config file and the settings in force. `apply_edits` puts the saved and then the temp browser edits over the config's settings.
- `settings_table.ts`: every setting as one row of data, its kind, values and default. The `Settings` type follows from it. Start here to add a setting.
- `settings_plan.ts`: the pure planners of `set`, `toggle` and `unset`: the edits to keep and the toast that answers. The `settings` commands and the settings page message run them.
- `settings_schema.ts`: what each setting accepts, derived from its table row. The build tool and `set` share it. The content script and the command line page must not import it.
- `settings_docs.ts`: the long description, plain label and one-line summary of each setting, for the settings file schema and the Settings page.
- `key_docs.ts`: fills the `{key:name}` marks of `settings_docs.ts` prose with the key the keymap binds: the live keymap for the Settings page, the default one for the schema.
- `bound_keys.ts`: which key runs a named action (`BINDINGS`, `bound_key`), read from the compiled keymap. Quick Start, the Settings docs and the new tab hint share it.
- `setting_completion.ts`: generated by `just settings-defaults` from the schema, one row per setting. The command line page reads it. Do not edit.
- `default_settings.ts`: generated by `just settings-defaults` from the table, one constant per setting. Do not edit.

The content script imports only part of this folder (types, constants, `keys/` and the small helpers it needs), to stay under its size guard. A new import into `content.js` must pass the
admission rule in `AGENTS.md`, "Content script size".
