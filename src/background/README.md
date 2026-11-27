# background

The background page. It loads the config, compiles the keymap, assigns the Firefox shortcut slots and routes run requests.

This folder and `src/commands/` import each other. `command_modules.ts` imports every command module for its side effect, and `main.ts` imports `command_modules.ts`. Commands call background
helpers (stores, `browser_deps.ts`). The background takes only the wiring calls in `main.ts` from `commands/`. The pure plan and URL helpers its modules use are in `src/shared/`
(`settings_plan.ts`, `url_build.ts`). A command module may use a background value while it loads (11 do: three by calling, `media.ts`, `help.ts` and `session.ts`, and the rest by reading
exports) only when that background module does not reach back to that command module, directly or through `availability.ts`.

The detail of the long entries moved to the "Background files" section of the `docs/design/` file for their area:
- Area `registry.md`: request routing, the message tables, the router, availability, snippets, the bundle loader.
- Area `config.md`: the keymap compile, edit layers, default site rows, engines, aliases, themes, CSS limits.
- Area `config_delivery.md`: the config store, swap, write pipeline, start read, import, export, settings file edits, timing log.
- Area `keys.md`: tab modes, item mode, the stored keymap and `read_keymap`, the toolbar switch. `interfaces_media.md`: media mode steps and quality.
- Area `interfaces_cmdline.md`: the command line service, omnibox, completion, ranking, fonts. `interfaces_pages.md`: which-key, help, external editor.
- Area `interfaces_tabs.md`: sessions, tab actions, discard, the live model. `interfaces_caret_search_marks.md`: registers, marks, jumps, macros, find.
- Area `interfaces_hints.md`: hint frames, inspect, images. `host.md`: the native client, host updates, the bridge.

- `main.ts`: registers the listeners, then waits for the config.
- `message_table.ts`: the table type and `dispatch`, the one `runtime.onMessage` listener, with a `from` sender guard per entry.
- `page_messages.ts`: the table of the messages extension pages send (settings, keys, engines, aliases, themes, quickmarks, imports, config files, sessions, toolbar).
- `content_messages.ts`: the table of the messages content scripts, bundles and the command line page send. `main.ts` builds the services and passes them in.
- `bookmark_title.ts`: `title_for_address`, the title that prefills a bookmark rename. A managed bookmark, which cannot be renamed, gives its title only when no other bookmark has the address.
- `favicon_saver.ts`: saves a 32x32 copy of each visited site's icon for the new tab page, from the `data:` icon Firefox hands over. It makes no request and saves a host at most once per window.
- `history_clear.ts`: what the browser's history clearing does to the stores that hold page addresses (marks, command line history, saved icons).
- `hold_on_arrival.ts`: holds the keys of a page that loads in a replay's tab before the keymap reply reaches it, so no key slips in before the replay's own hold.
- `storage_keys.ts` and `config_load.ts` live in `shared/config/`, because the help, new tab and popup pages read them too.
- `config_store.ts`: `get_config`, `publish` and the one change queue for every `set`, key edit and swap. `publish` keeps the edit layers on top of a swap.
- `config_swap.ts`: `apply_files`, the one swap of a reload, import, editor save and setting write, with `import_config`, `remove_snippet` and `save_config_file`.
- `config_file_writes.ts`: the host write pipeline: the per-path record, the batch write loop, the gate on the batch's end state, replay of a refused write and the question for a refused file.
- `config_setting_writes.ts`: the setting, site, theme and engine writes (`set_in_settings_file`, `commit_folder_files`, `change_engine_file`). Each plans a change and the pipeline sends it.
- `config_start.ts`: `reload_config`, the start read with its three migrations, and `choose_host_start`.
- `config_main.ts`: `create_config_service` wires the services, store, swap, write modules and start, and the file exports the production instances.
- `services.ts`: `create_services` builds `snippets`, `host_update`, `native_host` and the autoconfig mirror. It takes `get_config` late, which breaks the import cycle with the config store.
- `keymap_merge.ts`: merges the default keymap under the user keymap by key spelling. Open it for how two keymaps combine.
- `compile.ts`: compiles the config into the keymap, with the args check per binding. Open it for key edits, site rows and the keymap build.
- `shared/config/config_load.ts`: reads the files config that `config.reload` stored (`pick_config`, `load_effective_config`). Open it for what a page reads as the config.
- `edit_layers.ts`: the browser edit layers other than settings, one `storage.local` key and one load check per kind in `EDIT_LAYERS`.
- `item_hover.ts`: `without_hover` takes the `hover` arg off the `page.item` steps of a shipped row, for the `item_hover` setting off.
- `item_landings.ts`: `with_item_landings` gives a site row with an item selector the item-mode landing keys (`I`, `zt`, `zz`, `zb`, `}`, `{`). `compile.ts` applies it to user and shipped rows.
- `item_select.ts`: the `item_select` setting set to `arrows`.
- `tab_item.ts`: the item mode of a tab, in `storage.session`: the frames that reported it.
- `default_site_rows.ts`: the site rows that ship with DesertFox. `compile_config` appends those `default_site_rows_off` leaves on after the user's rows.
- `toolbar.ts`: the on/off switch (`create_toolbar`): the flag, the icon, the title and the mode of every tab.
- `omnibox.ts`: the `df` address bar keyword. Runs the text of Enter through the router and never prompts. Fills up to nine completion rows.
- `slots.ts`: `browser` chords to the 10 manifest slots.
- `repeat_memory.ts`: the request `.` replays, in `storage.session`, one slot for normal windows and one for private windows.
- `record_step.ts`: `record_step(steps, outcome, origin)`, the one call every finished request or leaf passes.
- `macro_recorder.ts`: the macro being recorded, in `storage.session` (a private key for private windows).
- `window_focus.ts`: the window ids in last-focused order, newest first, in `storage.session`. `tab.attach` with no window picks from it.
- `last_used_tab.ts`: the current and previous tab across every window, one pair for normal windows and one for private ones, in `storage.session`.
- `previous_tab.ts`: the tab each window was on before its current one, the tab `#` marks in the tab list.
- `tab_media.ts`: the media mode of a tab, in `storage.session`: the frames that reported it and the frame whose video `;M` pinned.
- `tab_steps.ts`: the mode steps of a tab go out in order, and the shared queue of reports never waits on them.
- `tab_modes.ts`: the mode of each tab, in `storage.local`: the mode of the child frame whose document holds the focus, else the top frame's.
- `tab_insert.ts`: insert mode for a whole tab, started by `i`. The background owns the hold and sends one message to every frame.
- `router.ts`: the one entry for run requests: count limit, content steps, prefill and jump record. Every request ends in `record_step`. Pieces: `count.ts`, `refusal.ts`.
- `count.ts`, `refusal.ts`: the count prefix check, and the refusal answer: a toast sent by tab message, with a notification as the fallback.
- `availability.ts`: the one check for "can this page fill what a thing needs?", shared by engines, snippets and which-key.
- `macro_last_played.ts`: the register `@@` plays, in `storage.session` (a private key for private windows, cleared with the last private window).
- `macro_replay.ts`: plays a macro for `macro.play`, one router request per step, with Escape (`replay_stop`). In memory only. `main.ts` wires it in.
- `site_keys.ts`: `answer_site_keys_request` checks the `site_keys` request.
- `strip_patterns.ts`: answers `read_strip_patterns` and resolves `copy.tabs` per tab.
- `keymap_source.ts`: the compiled keymap from `storage.local`, held in memory after the first read.
- `page_keymap.ts`: answers `read_keymap` (resolver: `shared/site/page_keymap_resolve.ts`) and the other per-site reads (hint selectors, quality, item start).
- `site_zoom.ts`: the `zoom` setting, applied on a tab's load through `tabs.setZoom`.
- `list_keys.ts`: answers which-key: the title and a row per next key under a typed prefix, for the active page.
- `bundle_loader.ts`: injects a bundle into a frame when the content script asks, once per document.
- `selection_ask.ts`: reads the selection of a frame for a `selection` context source, and the scroll offset of the top frame for a command with the `jumps` flag.
- `issue_report.ts`: the body and the URL of the `:issue` report.
- `load_log.ts`: the last 20 bundle loads in storage, which the key test reads. Writes run one at a time and a storage failure is dropped, so the log never fails a load. Pure.
- `timing_log.ts`, `timing_summary.ts`, `timing_browser.ts`: the last 300 timings in `storage.session`, and the pure summary that `debug.perf` copies.
- `snippets.ts`: the user's snippets as commands: `matches` and `requires` are checked here, the code runs in the top frame only.
- `cmdline_service.ts`: what the command line page asks for: the ticket, `open_cmdline` with its keys column, `record_cmdline`, and the opener and target frame of each line.
- `frame_cue.ts`: the toast in the top frame after `;ff` focused a frame. It names the key bound to `frame.exit`, or leaves that sentence out when none is.
- `open_help.ts`: `open_help` opens the help page at a command card in a foreground tab beside the asking tab, only for the frame whose line redeemed a ticket.
- `keymap_message.ts`: the key editor's messages `list_bindings`, `check_binding` and `change_keymap`, from top-level extension pages only.
- `engine_file.ts`, `engine_keys_file.ts`, `engine_message.ts`: the Engines page: its two files (`search_engines.d/zz-desertfox.toml`, `keymap.d/zz-desertfox.toml`) and its messages.
- `engine_layer_move.ts`: the move of the engines layer into the Engines page's two files, and of a saved `default_engine` edit into settings.toml.
- `saved_fold.ts`: the fold of the saved settings (`desertfox_saved_settings`) into settings.toml.
- `engine_layer.ts`: the engines layer (`EDIT_LAYERS.engines`), which holds only the engines of an older version that the start could not move.
- `alias_message.ts`, `quickmark_message.ts`: the Aliases and Quickmarks sections.
- `theme_message.ts`: the importer's messages (`list_imported_themes`, `change_imported_themes`).
- `extension_page.ts`: `is_extension_page`, the one test for a message sent by one of the add-on's own top-level pages. The settings messages and the bundle loader both use it.
- `settings_message.ts`: the settings page's messages `change_setting` and `list_settings`.
- `session_store.ts`: the saved tab sessions in `storage.local` (`desertfox_sessions`), a name store plus `plan_restore`. `commands/session.ts` does the browser calls.
- `store_turns.ts`: what the private-data stores share, and the previous-tab and window-focus stores use the queue.
- `font_names.ts`: `create_font_names(deps)`, the font names that `set font_family`, `set font_family_mono` and the Settings page suggest.
- `external_editor.ts`: the external editor job of each tab (`open`, `orphan`, `resume`), kept in `storage.session`.
- `mark_store.ts`: the local marks per page address, and the global marks. The background owns them and a tab reaches them by message.
- `quickmark_store.ts`: the quickmarks `M` saved, in `storage.local` (`desertfox_quickmarks`), or `storage.session` for a private window.
- `global_mark_jump.ts`: the jump of a global mark.
- `jump_store.ts`: the jump list, one list and cursor per window id, in `storage.session` (`JUMP_STORAGE_KEY`, and `JUMP_PRIVATE_STORAGE_KEY` for private windows, cleared as for marks).
- `jump_leave.ts`: records the place a page leaves when its tab goes to another page.
- `jump_step.ts`: answers `jump_push` and `jump_step`.
- `address_arrival.ts`: takes the user to an address (switch to the tab that has it, else navigate). The caller picks the push: `mark.jump` from `global_mark_jump.ts`, `page.jump` from `jump_step.ts`.
- `page_ready.ts`: `watch_page_ready(deps, tab_id)` waits for a tab to complete and its content script to answer, in at most 10 s. Start it before the step that navigates.
- `register_store.ts`: the registers. The background owns them and every tab reaches them by message. Names come from `src/shared/register_names.ts`.
- `sessions_transfer.ts`: answers the page messages `export_sessions` and `import_sessions` from the session store.
- `history_cache.ts`: the 20000 newest history rows, newest first, kept for history completion.
- `complete_items.ts`: `complete_items` answers the command line page with the lists it asks for (bookmarks, windows, folders, sessions, registers, engines), and `tab_rows_action` its row keys.
- `first_install.ts`: opens the help page at Quick Start when `runtime.onInstalled` gives reason `install`. Nothing else opens it.
- `tab_discard.ts`: the one place that calls `tabs.discard`.
- `media_actions.ts`: the `media` command across frames.
- `media_quality.ts`: the `media_quality` rule.
- `quality_levels.ts`: the `quality` bundle seen from the background, and the injections of the probe and of the bundle into one frame.
- `tab_actions.ts`: the one place that mutes, pins, moves and reopens tabs in a container, each over a list of ids.
- `browser_module.ts`: the state writer and hello reader for the optional browser module, kept in `storage.session`.
- `browser_module_rpc.ts`: the background end of DesertFox's page code on a locked page: page calls through the message table, pushes in place of `tabs.sendMessage`, the snapshots.
- `native_client.ts`: the client for the native host.
- `host_update.ts`, `host_update_browser.ts`: the host updater.
- `bridge.ts`, `bridge_browser.ts`, `bridge_run.ts`: publish the mode to the bridge host over one `connectNative` port and answer its `run`, `list` and `theme` requests.
- `tab_switch.ts`: the tab verbs the bridge host asks for (`tabs`, `activate`, `clear_preface`, `close`, `capture`, `favicon`).
- `bridge_events.ts`: the tab events the host streams to subscribers, gated by `bridge_share_tabs`.
- `reload.ts`: the marker and the tab repair behind `debug.restart`.
- `config_reload.ts`: the pure build behind every swap: raw files to the slot to store and the config to run, and every refusal as a `ConfigRefusal` whose message names the cause and the fix.
- `config_import.ts`: the pure part of an import from the settings page.
- `import_reach.ts`: pure. Lists what an import's built config can reach, by address and by key row group.
- `css_limits.ts`: the CSS rule of user CSS (`css_limit_breaches`), checked by every build of files.
- `config_transfer.ts`: the settings page's export, snippet list and snippet removal.
- `config_files.ts`: the answer to the files editor's `config_files` message: the stored files out (without `autoconfig.toml`), one save in.
- `host_start.ts`: what a start does with the host's config folder.
- `settings_file.ts`, `toml_key_edit.ts`, `toml_table_edit.ts`: a setting written into, or removed from, settings.toml. `config_setting_writes.ts` runs the write.
- `autoconfig_mirror.ts`: writes a comment line, then all stored key edits as keymap.d mode tables, to `autoconfig.toml` through the host, one write at a time.
- `hint_frames.ts`: one label set across the frames of a tab, for `hint --all-frames`.
- `inspect_relay.ts`: hands a hint pick (`inspect_pick` from the `hints` bundle) to the devtools page of the picked tab.
- `rank_service.ts`, `rank_worker.ts`, `rank_index.ts`, `completion_rank.ts`: history ranking for `open`, `history` and the finder, in a Worker that holds the only copy of the history rows.
- `find_scan.ts`: answers `find_scan` from the `caret` bundle.
- `find_worker.ts`, `regex_scan.ts`: the Worker of each regex page search (its own `find_worker.js` build entry) and the pure scan it runs.
- `image_actions.ts`: answers `image_action` from the `hints` bundle.
- `browser_deps.ts`: the only file that wires the router to Firefox calls.
- `tab_split.ts`: `focus_other_pane` and `swap_panes` (`tab.split_other`, `tab.split_swap`) over `TabSplitDeps`; a swap moves the partner onto the tab's place.
- `tab_model.ts`: the live tab model (rows also carry `group_id` and `split_id`, and a groups table follows the `tabGroups` events).
- `command_modules.ts`: one import per command group. The commands.json build tool imports it, so it is the only list.

Browser access has three conventions. A `*_browser.ts` sibling holds the calls (`bridge_browser.ts`, `host_update_browser.ts`, `timing_browser.ts`). A `browser_x` export sits in the same
file as its logic. Some files call `browser.storage` directly (`shared/config/config_load.ts`, `edit_layers.ts`, `settings_file.ts`, `main.ts`). Logic that tests run without a browser takes
its browser access as arguments.
