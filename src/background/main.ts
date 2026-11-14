import "./command_modules.ts";
import { best_effort, ignore_refusal, refused_as, warn_and_go } from "../shared/swallow.ts";
import type { ContentToBackground, DevtoolsHello, FocusedFrameMode, FocusPage, PageToBackground } from "../shared/messages.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { effective_settings } from "../shared/config.ts";
import { bundle_loader, container_names, read_disabled, container_stores, image_deps, make_router_deps, page_of, reinject_deps } from "./browser_deps.ts";
import { run_image_action } from "./image_actions.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { open_quick_start_on_install } from "./first_install.ts";
import { create_cmdline_service } from "./cmdline_service.ts";
import { create_frame_cue } from "./frame_cue.ts";
import { relay_plan } from "../shared/relay.ts";
import { stored_keymap } from "./keymap_source.ts";
import { history_cache } from "./history_cache.ts";
import { clear_on_history_removed } from "./history_clear.ts";
import { make_favicon_cache } from "../newtab/icon_cache.ts";
import { make_favicon_saver, redraw_icon_png } from "./favicon_saver.ts";
import { shared_previous_tabs } from "./previous_tab.ts";
import { shared_last_used_tabs } from "./last_used_tab.ts";
import { browser_discard_deps } from "./tab_discard.ts";
import { browser_complete_items_deps, create_complete_items } from "./complete_items.ts";
import type { Asker } from "./complete_items.ts";
import { browser_tab_action_deps } from "./tab_actions.ts";
import { create_open_help } from "./open_help.ts";
import { requirement_lookup, site_engine_for, with_site_engines } from "./availability.ts";
import { mark_list_rows, quickmark_list_rows } from "../shared/mark_text.ts";
import { list_keys } from "./list_keys.ts";
import { start_bridge } from "./bridge_browser.ts";
import { strip_patterns_for } from "./strip_patterns.ts";
import { hint_selectors_reply, join_mode, media_quality_is_idle, media_quality_reply, rule_addresses_of, read_keymap_reply } from "./page_keymap.ts";
import { track_window_focus } from "./window_focus.ts";
import { create_external_editor, ext_of_request, make_editor_ext_for } from "./external_editor.ts";
import { create_site_zoom, make_level_for } from "./site_zoom.ts";
import { create_inspect_relay } from "./inspect_relay.ts";
import { repair_tabs_after_reload } from "./reload.ts";
import { browser_tab_model_deps, create_tab_model } from "./tab_model.ts";
import { browser_find_scan_deps, create_find_scan, is_scan_request } from "./find_scan.ts";
import { browser_hint_frames_deps, create_hint_frames } from "./hint_frames.ts";
import { create_word_lookup } from "../cmdline/word_lookup.ts";
import { build_completer, create_omnibox, OMNIBOX_HINT } from "./omnibox.ts";
import { create_router } from "./router.ts";
import { wire_private_cleanup } from "./store_turns.ts";
import { answer_mark_request, browser_mark_store } from "./mark_store.ts";
import { browser_quickmark_store } from "./quickmark_store.ts";
import { answer_register_request, browser_register_store } from "./register_store.ts";
import { answer_repeat_preview, create_repeat_memory } from "./repeat_memory.ts";
import { create_step_recorder, page_outcome, page_steps } from "./record_step.ts";
import type { RecordStep } from "./record_step.ts";
import { browser_macro_recorder } from "./macro_recorder.ts";
import { browser_last_played } from "./macro_last_played.ts";
import { create_macro_replay, wire_macro_replay } from "./macro_replay.ts";
import { reply_after_hold } from "./hold_on_arrival.ts";
import { check_play_step } from "../commands/macro.ts";
import { wire_repeat } from "../commands/command.ts";
import { wire_tab_insert } from "../commands/mode.ts";
import { create_media_quality, rule_for_report } from "./media_quality.ts";
import { ask_quality_in_tab, frame_address, inject_probe_about_blank, inject_probe_for_rule, inject_quality_into_frame, quality_reports, quality_rows } from "./quality_levels.ts";
import { tab_media } from "../commands/media.ts";
import { create_media_discovery } from "./tab_media.ts";
import { MEDIA_PANEL_HANDLER } from "../content/whichkey/media_panel.ts";
import { create_tab_insert } from "./tab_insert.ts";
import { DISABLED_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY } from "./storage_keys.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { has_content_script, send_to_tab, show_toast_on_tab } from "./browser_deps.ts";
import { create_global_mark_jump } from "./global_mark_jump.ts";
import { browser_jump_store } from "./jump_store.ts";
import { create_jump_step } from "./jump_step.ts";
import { create_jump_leave } from "./jump_leave.ts";
import { watch_page_ready } from "./page_ready.ts";
import { native_host, choose_host_start, change_edits, change_layers, get_config, get_search_engine_names, import_config, preview_config_import, host_update, reload_config_at_start, reload_config, read_alias_state, read_engine_state, read_keymap_state, remove_snippet, republish, save_config_file, set_desktop_theme, snippets } from "./startup.ts";
import { answer_config_import } from "./config_import.ts";
import { answer_toolbar_request, create_toolbar, TOGGLE_COMMAND } from "./toolbar.ts";
import { load_edits, load_effective_config, load_files_source } from "./config_load.ts";
import { answer_config_transfer } from "./config_transfer.ts";
import { answer_config_files } from "./config_files.ts";
import { browser_timing_log } from "./timing_browser.ts";
import { accept_hint_timing } from "./timing_log.ts";
import { browser_session_storage, make_session_store } from "./session_store.ts";
import { answer_sessions_transfer } from "./sessions_transfer.ts";
import { create_settings_messages } from "./settings_message.ts";
import { is_extension_page } from "./extension_page.ts";
import { answer_host_start_choice } from "./host_start.ts";
import { create_keymap_messages, exportable_key_edits } from "./keymap_message.ts";
import { create_engine_messages } from "./engine_message.ts";
import { create_alias_messages } from "./alias_message.ts";
import { create_quickmark_messages } from "./quickmark_message.ts";
import { ConfigRefusal } from "./config_reload.ts";
import { dropped_warning } from "./engine_layer.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { command_meta } from "../shared/registry/index.ts";
import { registry } from "../shared/registry/builtin.ts";
import { create_tab_modes, hand_back_parked_frame, is_cross_origin, shortcut_allowed } from "./tab_modes.ts";
import type { SlotTable } from "./slots.ts";
import type { SnippetCall } from "./snippets.ts";

const tab_modes = create_tab_modes(browser.storage.local);
// Queued first, so the clear never removes a fresh report.
const modes_cleared = tab_modes.forget_all();
const tab_insert = create_tab_insert({
  storage: browser.storage.local,
  modes_cleared,
  send_mode: (tab_id, mode) => send_to_tab(tab_id, { type: "set_mode", mode, held: true }),
});
wire_tab_insert(tab_insert.enter);

// Taken before the config loads, so it holds the built-in commands only, which are the ones the help page has cards for.
const built_in_ids = new Set(registry.list().map((command) => command.id));

const has_private_window = async () => (await browser.windows.getAll()).some((window) => window.incognito);
const repeat_memory = create_repeat_memory(browser.storage.session, has_private_window);
// `.` and the macro recorder both read every finished request.
const record_step: RecordStep = async (steps, outcome, origin) => {
  await create_step_recorder({ get_command: (id) => registry.get(id), repeat_memory })(steps, outcome, origin);
  await browser_macro_recorder.record(steps, outcome, origin);
};
const media_discovery = create_media_discovery({
  storage: browser.storage.session,
  tab_is_open: async (tab_id) => (await ignore_refusal(browser.tabs.get(tab_id))) !== undefined,
  which_key_delay_ms: async () => effective_settings((await get_config()).settings).which_key_delay_ms,
  close_panel: (tab_id) => best_effort(send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: "whichkey", args: {}, bundle: "whichkey" }] }, 0)),
  open_panel: (tab_id) => best_effort(send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: MEDIA_PANEL_HANDLER, args: {}, bundle: "whichkey" }] }, 0)),
});
const router_deps = { ...make_router_deps(get_config, repeat_memory), record_step };
const router = create_router(router_deps);
const watch_tab = (tab_id: number) =>
  watch_page_ready({ get_tab: (id) => ignore_refusal(browser.tabs.get(id)), on_updated: browser.tabs.onUpdated, on_removed: browser.tabs.onRemoved, has_content_script, set_timer: (callback, ms) => setTimeout(callback, ms), clear_timer: (timer) => clearTimeout(timer as number) }, tab_id);
const macro_replay = create_macro_replay({
  read_macro: async (register, is_private) => {
    const value = await browser_register_store.read(register, is_private);
    return Array.isArray(value) ? value : undefined;
  },
  // No command line opens: the recorder stored each prompted step with its value.
  run_step: (step, { tab_id, frame_id, mode, step_number }, lost_reply_is_done) => router.run({ invocations: [step], mode, frame_id, instant: true, lost_reply_is_done, macro_step: step_number, ...(tab_id === undefined ? {} : { sender_tab_id: tab_id }) }),
  active_tab_id: async () => (await router_deps.active_tab())?.tab_id,
  is_loading: async (tab_id) => (await ignore_refusal(browser.tabs.get(tab_id)))?.status === "loading",
  watch: watch_tab,
  hold_keys: (tab_id) => send_to_tab(tab_id, { type: "replay_hold" }),
  show_refusal: (tab_id, message) => router_deps.show_refusal(tab_id, { id: "macro.play", message }),
  last_played: browser_last_played,
  check_play: check_play_step,
});
wire_macro_replay(macro_replay);
const global_mark_tabs = async () => (await browser.tabs.query({})).flatMap((tab) => (tab.id === undefined || tab.windowId === undefined || tab.url === undefined ? [] : [{ id: tab.id, window_id: tab.windowId, index: tab.index, url: tab.url, incognito: tab.incognito, last_accessed: tab.lastAccessed ?? 0, discarded: tab.discarded === true }]));
const global_mark_jump = create_global_mark_jump({
  store: browser_mark_store,
  list_tabs: global_mark_tabs,
  activate_tab: (tab_id) => browser.tabs.update(tab_id, { active: true }),
  focus_window: (window_id) => browser.windows.update(window_id, { focused: true }),
  navigate: (tab_id, url) => browser.tabs.update(tab_id, { url }),
  watch: watch_tab,
  push_jump: (tab_id, key, arrival) => send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: "mark.jump", args: { key, arrival }, bundle: "page" }] }, 0),
  record_jump: (window_id, is_private, entry) => browser_jump_store.push(window_id, is_private, entry),
  read_top_offset: (tab_id) => router_deps.read_offset(tab_id),
  show_refusal: (tab_id, message) => router_deps.show_refusal(tab_id, { id: "mark.jump", message }, 0),
});
const jump_step = create_jump_step({
  store: browser_jump_store,
  list_tabs: global_mark_tabs,
  activate_tab: (tab_id) => browser.tabs.update(tab_id, { active: true }),
  focus_window: (window_id) => browser.windows.update(window_id, { focused: true }),
  navigate: (tab_id, url) => browser.tabs.update(tab_id, { url }),
  watch: watch_tab,
  push_jump: (tab_id, steps, arrival) => send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: "page.jump", args: { direction: steps < 0 ? "older" : "newer", steps: Math.abs(steps), ...(arrival && { arrival }) }, bundle: "page" }] }, 0),
  show_refusal: (tab_id, message) => router_deps.show_refusal(tab_id, { id: "page.jump", message }, 0),
});
const jump_leave = create_jump_leave({
  store: browser_jump_store,
  tab_now: async (tab_id) => {
    const tab = await ignore_refusal(browser.tabs.get(tab_id));
    return tab && { url: tab.url, status: tab.status };
  },
});
const is_private_tab = async (tab_id: number | undefined) => tab_id !== undefined && (await ignore_refusal(browser.tabs.get(tab_id)))?.incognito === true;
// A replay is a request like any other: it stores itself again, so `3.` keeps its count for the next `.`.
wire_repeat({
  load: async (ctx) => repeat_memory.load(await is_private_tab(ctx.tab_id)),
  run_batch: (invocations, ctx) =>
    router.run({ invocations, mode: ctx.mode, frame_id: ctx.frame_id, ...(ctx.tab_id === undefined ? {} : { sender_tab_id: ctx.tab_id }), ...(ctx.from_page && { from_page: true }) }),
});
const cmdline = create_cmdline_service({
  storage: browser.storage.local,
  tickets: browser.storage.session,
  new_ticket: () => crypto.randomUUID(),
  sources: async () => ({ search_engines: await get_search_engine_names(), containers: await container_names() }),
  // A failed query must not stop the line from opening.
  tab_count: async (window_id) => (await refused_as(browser.tabs.query({ windowId: window_id }), [])).length,
  container_stores,
  frame_exists: async (tab_id, frame_id) => {
    const frame = await refused_as(browser.webNavigation.getFrame({ tabId: tab_id, frameId: frame_id }), null);
    return frame !== null && frame !== undefined && !frame.errorOccurred;
  },
  page_config: async () => {
    const config = await get_config();
    const settings = effective_settings(config.settings);
    return { commands: registry.list().map(command_meta), help_ids: [...built_in_ids], command_aliases: config.command_aliases, prompt: settings.cmdline_prompt, all_windows: settings.completion_all_windows, statusbar_widgets: settings.statusbar_widgets };
  },
});

const frame_cue = create_frame_cue({
  keymap: () => stored_keymap(browser.storage.local),
  commands: () => registry.list().map(command_meta),
  toast_in_top: (tab_id, message, duration_ms) => best_effort(send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: "ui.toast", args: { message, kind: "info", duration_ms }, bundle: "ui" }] }, 0)),
});
// A frame that navigates is a new document: the line opened for the old one must not aim at it.
browser.webNavigation.onCommitted.addListener(({ tabId, frameId }) => void cmdline.forget_target_frame(tabId, frameId).catch(warn_and_go("cmdline.forget_target_frame")));

const previous_tabs = shared_previous_tabs();
const last_used_tabs = shared_last_used_tabs();
// Queued before any event, so the events of this start apply on top of the seed.
void last_used_tabs.seed();

const open_help = create_open_help({
  is_opener: cmdline.is_opener,
  is_command: (command_id) => built_in_ids.has(command_id),
  help_page_url: browser.runtime.getURL(HELP_PAGE_FILE),
  open_tab: (tab) => browser.tabs.create(tab),
});

const complete_items = create_complete_items({
  ...browser_complete_items_deps,
  previous_tab: previous_tabs.previous_of,
  is_opener: cmdline.is_opener,
  search_engines: async () => (await get_config()).search_engines,
  page_of,
  line_frame_url: async (tab_id) => {
    const frame_id = await cmdline.target_of(tab_id);
    return frame_id === undefined ? undefined : (await refused_as(browser.webNavigation.getFrame({ tabId: tab_id, frameId: frame_id }), null))?.url;
  },
  marks: async (url, is_private) => (url === undefined ? [] : mark_list_rows(await browser_mark_store.items(url, is_private))),
  quality_levels: async (tab_id) => quality_rows(await ignore_refusal(ask_quality_in_tab(tab_id, { type: "quality_apply", op: "list", value: undefined, times: 1 }))),
  quickmarks: async (is_private) => quickmark_list_rows(await browser_quickmark_store.table((await get_config()).quickmarks, is_private)),
  saved_quickmarks: async (is_private) => quickmark_list_rows(await browser_quickmark_store.saved(is_private)),
  quickmark_table: async (is_private) => browser_quickmark_store.table((await get_config()).quickmarks, is_private),
  read_tab: (tab_id) => ignore_refusal(browser.tabs.get(tab_id)),
  discard: browser_discard_deps,
  tab_actions: browser_tab_action_deps,
  open_settings: async () => {
    const { open_completion, history_completion_max } = effective_settings((await get_config()).settings);
    return { sources: open_completion, history_max: history_completion_max };
  },
  history_list_max: async () => effective_settings((await get_config()).settings).history_list_max,
});

track_window_focus(browser.storage.session, browser.windows);
// Focusing another window changes the tab in view without a `tabs.onActivated`.
browser.windows.onFocusChanged.addListener((window_id) => void last_used_tabs.focused(window_id));
browser.windows.onRemoved.addListener((window_id) => void last_used_tabs.window_removed(window_id));

const inspect_relay = create_inspect_relay(browser.storage.session, Date.now);
// Only the extension's own devtools page may register, because a content script can open a port too.
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "devtools_inspect" || !is_extension_page(port.sender ?? {}, browser.runtime.id, browser.runtime.getURL("devtools.html")) || port.sender?.tab !== undefined) return;
  port.onMessage.addListener((message: unknown) => {
    const hello = message as DevtoolsHello | undefined;
    if (hello?.type === "devtools_hello" && Number.isInteger(hello.tab_id)) void inspect_relay.connected(hello.tab_id, port, (listener) => port.onDisconnect.addListener(listener));
  });
});

const asker_of = (sender: browser.runtime.MessageSender): Asker | undefined => {
  const { id, windowId, incognito } = sender.tab ?? {};
  return id === undefined || windowId === undefined || sender.frameId === undefined ? undefined : { tab_id: id, frame_id: sender.frameId, window_id: windowId, incognito: incognito === true };
};
const find_scan = create_find_scan(browser_find_scan_deps());
const hint_frames = create_hint_frames({
  ...browser_hint_frames_deps(),
  parked_frame: (tab_id) => tab_modes.parked_frame(tab_id),
  unpark: async (tab_id, frame_id) => {
    const unparked = await tab_modes.unpark(tab_id, frame_id);
    if (unparked) void best_effort(browser.tabs.sendMessage(tab_id, { type: "frame_mode", ...(unparked.child_mode === undefined ? {} : { mode: unparked.child_mode }) } satisfies FocusedFrameMode, { frameId: 0 }));
  },
});
const toolbar = create_toolbar({
  read_disabled,
  write_disabled: (disabled) => (disabled ? browser.storage.local.set({ [DISABLED_STORAGE_KEY]: true }) : browser.storage.local.remove(DISABLED_STORAGE_KEY)),
  set_look: ({ path, title }) => Promise.all([browser.browserAction.setIcon({ path }), browser.browserAction.setTitle({ title })]).then(() => undefined),
  republish,
  tabs: async () => (await browser.tabs.query({})).flatMap((tab) => (tab.id === undefined ? [] : [{ tab_id: tab.id, url: tab.url }])),
  set_tab_mode: (tab_id, mode) => send_to_tab(tab_id, { type: "set_mode", mode }),
});
void toolbar.sync_look();
const bridge = start_bridge(tab_modes.recall, router_deps, snippets.is_snippet, set_desktop_theme, host_update.bridge_ready);
host_update.on_updated(() => bridge.reconnect());
// The one host read of a start: it also reports the host's version, which the bridge does not when it is off. Without the permission the client sends nothing.
void reload_config_at_start();
const settings_messages = create_settings_messages({ change_edits, read_layers: load_effective_config });
// The build ships the sample as `starter_engines.toml`. A missing file means a broken build, and the message says which file.
async function read_starter_engines(): Promise<string> {
  const missing = new ConfigRefusal("The starter engines file starter_engines.toml is missing from this build.");
  try {
    const response = await fetch(browser.runtime.getURL("starter_engines.toml"));
    if (response.ok) return await response.text();
  } catch {
    // Firefox rejects the fetch of a missing extension file instead of answering with a bad status, so both mean the same.
  }
  throw missing;
}
const engine_messages = create_engine_messages({ read_engine_state, change_layers, read_starter: read_starter_engines });
const alias_messages = create_alias_messages({ read_alias_state, change_layers });
const quickmark_messages = create_quickmark_messages({ store: browser_quickmark_store, configured: async () => (await get_config()).quickmarks });
const keymap_messages = create_keymap_messages({ default_keymap: DEFAULT_KEYMAP, registry, read_keymap_state, change_layers });

// Listeners register in the first turn, so no event is missed while the config loads.
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  const request = message as ContentToBackground;
  const page_request = message as PageToBackground | undefined;
  if (page_request?.type === "change_setting" || page_request?.type === "list_settings") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may change settings" });
    return get_config().then((): Promise<unknown> => (page_request.type === "list_settings" ? settings_messages.list() : settings_messages.change(page_request)));
  }
  if (page_request?.type === "list_bindings" || page_request?.type === "check_binding" || page_request?.type === "change_keymap") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may change keys" });
    if (page_request.type === "list_bindings") return keymap_messages.list();
    return page_request.type === "check_binding" ? keymap_messages.check(page_request) : keymap_messages.change(page_request);
  }
  if (page_request?.type === "list_engines" || page_request?.type === "change_engines") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may change engines" });
    return page_request.type === "list_engines" ? engine_messages.list() : engine_messages.change(page_request);
  }
  if (page_request?.type === "list_aliases" || page_request?.type === "change_aliases") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may change aliases" });
    return page_request.type === "list_aliases" ? alias_messages.list() : alias_messages.change(page_request);
  }
  if (page_request?.type === "list_quickmarks" || page_request?.type === "change_quickmarks") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may change quickmarks" });
    return page_request.type === "list_quickmarks" ? quickmark_messages.list() : quickmark_messages.change(page_request);
  }
  if (page_request?.type === "preview_config_import" || page_request?.type === "commit_config_import") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may import a config" });
    return answer_config_import(page_request, { preview: preview_config_import, commit: import_config });
  }
  if (page_request?.type === "export_config" || page_request?.type === "list_snippets" || page_request?.type === "remove_snippet") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may export or change snippets" });
    return answer_config_transfer(page_request, { read_files: async () => (await load_files_source()).files, read_saved: async () => (await load_edits()).saved, read_keymap_edits: async () => exportable_key_edits(await read_keymap_state()), read_engine_edits: async () => { const state = await read_engine_state(); return { edits: state.kept, aliases: state.kept_aliases, skipped: state.dropped.map(dropped_warning) }; }, read_quickmarks: () => browser_quickmark_store.saved(false), remove: remove_snippet });
  }
  if (page_request?.type === "config_files") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may edit the config files" });
    return answer_config_files(page_request, { read_files: async () => (await load_files_source()).files, save: save_config_file });
  }
  if (page_request?.type === "host_start_choice") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may answer the config folder question" });
    return answer_host_start_choice(page_request, choose_host_start);
  }
  if (page_request?.type === "export_sessions" || page_request?.type === "import_sessions") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may export or import sessions" });
    return answer_sessions_transfer(page_request, make_session_store(browser_session_storage));
  }
  if (page_request?.type === "toolbar_set_disabled" || page_request?.type === "toolbar_site" || page_request?.type === "toolbar_reload_config") {
    if (!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""))) return Promise.resolve({ ok: false, message: "only the extension's own pages may use the toolbar" });
    return answer_toolbar_request(page_request, { toolbar, change_edits, read_file_site_rules: async () => (await load_effective_config()).config_settings.site_rules ?? [], reload_config });
  }
  if (request?.type === "mode_changed" && sender.tab?.id !== undefined && sender.frameId !== undefined) {
    const tab = sender.tab;
    const tab_id = sender.tab.id;
    // The top frame leaving insert by any route ends the hold.
    if (sender.frameId === 0 && request.mode !== "insert") void tab_insert.top_frame_left_insert(tab_id, request.mode).catch(warn_and_go("tab_insert.top_frame_left_insert"));
    void media_discovery.reported(tab_id, sender.frameId, request.mode).catch(warn_and_go("media_discovery.reported"));
    const report = { frame_id: sender.frameId, mode: request.mode, focus: request.focus === true, activated: request.activated, in_field: request.in_field, cross_origin: is_cross_origin(sender.url, tab.url) };
    void tab_media.reported(tab_id, sender.frameId, request.mode, report.focus, request.step === true).catch(warn_and_go("tab_media.reported"));
    // The top frame may still be loading and miss the message. Its own start report brings a fresh one.
    return tab_modes.report(tab_id, report).then(({ child_mode, tell_top, park, parked }) => {
      // The frame that takes the focus on load is handed back through the path of `gF`. Gecko may give the focus back to the frame, and the park then ends in frame mode, as it was before parking.
      if (park) {
        const park_message = { type: "focus_page", park: true } satisfies FocusPage;
        void hand_back_parked_frame(async () => (await browser.tabs.sendMessage(tab_id, park_message, { frameId: sender.frameId })) === true, () => best_effort(browser.tabs.sendMessage(tab_id, park_message, { frameId: 0 })));
      }
      // The bridge shows the tab's mode, which a focused child frame or ignore mode in the top frame decides. Every top frame report publishes, as a new page's first one must, and a child frame's report does when it changed what the tab shows.
      if (sender.frameId === 0 || tell_top) void tab_modes.recall(tab_id).then((mode) => bridge.mode_changed(tab, mode));
      if (tell_top) void best_effort(browser.tabs.sendMessage(tab_id, { type: "frame_mode", ...(child_mode === undefined ? {} : { mode: child_mode }), ...(parked && { parked: true as const }) } satisfies FocusedFrameMode, { frameId: 0 }));
    });
  }
  if (request?.type === "quality_report") {
    quality_reports.receive(sender.tab?.id, sender.frameId, request);
    return rule_for_report(request, { is_disabled: read_disabled, value_for_frame: () => media_quality_reply(browser.storage.local, sender.url) });
  }
  if (request?.type === "quality_probe") return media_quality.probe_reported(sender.tab?.id, sender.frameId, request.address);
  if (request?.type === "record_timing") return void accept_hint_timing(browser_timing_log, request);
  if (request?.type === "media_pin" && sender.tab?.id !== undefined && sender.frameId !== undefined) return tab_media.pin(sender.tab.id, sender.frameId);
  if (request?.type === "replay_end") return macro_replay.ended();
  if (request?.type === "replay_stop") return void macro_replay.stop();
  if (request?.type === "leave_tab_insert" && sender.tab?.id !== undefined) return tab_insert.leave(sender.tab.id);
  if (request?.type === "load_bundle") return bundle_loader.answer(sender, request.name);
  if (typeof request?.type === "string" && request.type.startsWith("hint_frames_") && sender.tab?.id !== undefined && sender.frameId !== undefined) {
    const [tab_id, frame_id] = [sender.tab.id, sender.frameId];
    if (request.type === "hint_frames_start") return hint_frames.start(tab_id, frame_id, request);
    if (request.type === "hint_frames_report") return hint_frames.report(tab_id, frame_id, request.session_id, request.count, request.texts);
    if (request.type === "hint_frames_typed") return hint_frames.typed(tab_id, frame_id, request.session_id, request.typed, request.matches && { matches: request.matches, active: request.active });
    if (request.type === "hint_frames_pick") return hint_frames.pick(tab_id, frame_id, request.session_id, request.label, request.keys);
    if (request.type === "hint_frames_end") return hint_frames.end(tab_id, frame_id, request.session_id);
    if (request.type === "hint_frames_unhover") return hint_frames.unhover(tab_id, request.session_id);
  }
  if (request?.type === "find_scan" && is_scan_request(request)) return find_scan.answer(request, `${sender.tab?.id}:${sender.frameId}`);
  if (request?.type === "register_read" || request?.type === "register_write" || request?.type === "register_yank") return answer_register_request(browser_register_store, request, sender.tab);
  if (request?.type === "mark_set" || request?.type === "mark_jump") return answer_mark_request(browser_mark_store, request, sender.tab && { incognito: sender.tab.incognito, id: sender.tab.id, window_id: sender.tab.windowId, url: sender.tab.url, frame_id: sender.frameId }, global_mark_jump);
  if (request?.type === "editor_open" && sender.tab?.id !== undefined && sender.frameId !== undefined) {
    const tab_id = sender.tab.id;
    const frame_id = sender.frameId;
    const stamp = external_editor.navigation_stamp(tab_id);
    return get_config().then(async () => external_editor.open(tab_id, frame_id, request, await ext_of_request(request.ext, () => editor_ext_for(rule_addresses_of(sender))), sender.tab?.incognito === true, stamp));
  }
  if (request?.type === "jump_push" || request?.type === "jump_step") return jump_step(request, sender.tab && { incognito: sender.tab.incognito, id: sender.tab.id, window_id: sender.tab.windowId, url: sender.tab.url, frame_id: sender.frameId });
  if (request?.type === "jump_leave") return jump_leave.leave(request, sender.tab && { incognito: sender.tab.incognito, id: sender.tab.id, window_id: sender.tab.windowId, url: sender.tab.url, frame_id: sender.frameId }, sender.url ?? "").catch(warn_and_go("jump_leave.leave"));
  if (request?.type === "issue_cmdline_ticket") return cmdline.issue_ticket(sender.tab?.id, Number.isInteger(request.target_frame) ? request.target_frame : undefined);
  if (request?.type === "relay") {
    const plan = relay_plan(request, sender.frameId);
    return plan && sender.tab?.id !== undefined ? send_to_tab(sender.tab.id, { type: "run_in_content", invocations: [plan.invocation] }, plan.frame_id) : Promise.resolve({ ok: false, message: "relay refused" });
  }
  if (request?.type === "frame_cue" && sender.tab?.id !== undefined) {
    const tab_id = sender.tab.id;
    // A frame that asks names itself. The top page cannot name the frame of another site that it focuses, so its mark covers the next first focus of any frame.
    return tab_modes.expect_entry(tab_id, sender.frameId === 0 ? undefined : sender.frameId).then(() => (request.toast ? frame_cue(tab_id) : undefined));
  }
  if (request?.type === "open_cmdline") return get_config().then(() => cmdline.open(request.ticket, sender.tab?.id, sender.frameId, sender.tab?.windowId, sender.tab, sender.tab?.incognito === true));
  if (request?.type === "complete_items") return complete_items.answer(request.kind, asker_of(sender));
  if (request?.type === "tab_rows_action") return complete_items.tab_rows_action(request.action, request.tab_ids, asker_of(sender), request.cookie_store_id);
  if (request?.type === "image_action") return run_image_action(image_deps, request, { incognito: sender.tab?.incognito === true, cookie_store_id: sender.tab?.cookieStoreId });
  if (request?.type === "inspect_pick") return sender.tab?.id === undefined ? Promise.resolve({ ok: false, message: "No tab to inspect" }) : inspect_relay.pick(sender.tab.id);
  if (request?.type === "read_hint_selectors") return hint_selectors_reply(browser.storage.local, sender.url);
  if (request?.type === "read_strip_patterns") return strip_patterns_for(browser.storage.local, request.address);
  if (request?.type === "read_keymap") {
    const reply = () => browser_macro_recorder.register_of(sender.tab?.incognito === true).catch(warn_and_go("macro register_of")).then((recording) => read_keymap_reply(browser.storage.local, rule_addresses_of(sender), recording, sender.tab?.id === undefined || sender.frameId === undefined ? undefined : () => join_mode(request.join, () => tab_insert.join(sender.tab!.id!, sender.frameId!), () => tab_media.join(sender.tab!.id!, sender.frameId!))));
    return reply_after_hold(macro_replay, (tab_id, frame_id) => send_to_tab(tab_id, { type: "replay_hold" }, frame_id), sender.tab?.id, sender.frameId, reply);
  }
  if (request?.type === "open_help") return open_help.open(request.command_id, sender.tab?.id, sender.frameId);
  if (request?.type === "record_cmdline") return cmdline.record(request.text, sender.tab?.incognito === true);
  if (request?.type === "record_step") {
    // The turn is entered before the first await, so records land in arrival order and a `.` that arrives next waits for this write.
    const origin = { is_private: sender.tab?.incognito === true, ...(request.pick === true && { from_pick: true }) };
    const checked = repeat_memory.in_turn(async (unqueued) => {
      await get_config();
      const steps = page_steps(request, (id) => registry.get(id), { search_engines: await get_search_engine_names(), containers: await container_names() });
      if (steps) await create_step_recorder({ get_command: (id) => registry.get(id), repeat_memory: unqueued })(steps, page_outcome(request), origin);
      return steps;
    });
    return Promise.all([checked, browser_macro_recorder.record_page(checked, page_outcome(request), origin)]).then(() => undefined);
  }
  if (request?.type === "read_repeat_preview") {
    return get_config().then((config) => answer_repeat_preview({ is_private: sender.tab?.incognito === true, enabled: effective_settings(config.settings).which_key_repeat }, repeat_memory, (id) => registry.get(id)));
  }
  if (request?.type === "list_keys") {
    const tab = sender.tab;
    const page = tab?.url ? { url: tab.url, ...(tab.title ? { title: tab.title } : {}) } : undefined;
    return get_config().then((config) => list_keys(browser.storage.local, (id) => registry.get(id), request, {
      availability: {
        page,
        requirement_of: requirement_lookup(config),
        site_engine_label_of: (invocation) => config.search_engines[site_engine_for(config.search_engines, invocation.site_search?.engines ?? [], page) ?? ""]?.label,
      },
      addresses: rule_addresses_of(sender),
      registers: () => browser_register_store.items(tab?.incognito === true),
      marks: () => browser_mark_store.items(sender.url ?? "", tab?.incognito === true),
      quickmarks: () => browser_quickmark_store.table(config.quickmarks, tab?.incognito === true),
      macros: () => browser_register_store.macro_items(tab?.incognito === true),
    }));
  }
  if ((message as SnippetCall)?.type === "snippet_run") {
    return get_config().then(() => snippets.handle_call(message as SnippetCall, { tab_id: sender.tab?.id, frame_id: sender.frameId }));
  }
  if (request?.type !== "run") return undefined;
  if (sender.tab?.id !== undefined && sender.frameId !== undefined) void media_discovery.key_ran(sender.tab.id, sender.frameId, request.mode).catch(warn_and_go("media_discovery.key_ran"));
  return get_config().then(async (config) => {
    await macro_replay.wait_unless_from(sender.tab?.id);
    // A line drawn in the top frame for a subframe's keys runs its command in that subframe, if that frame is still there.
    const frame_id = (request.from_line === true ? await cmdline.target_of(sender.tab?.id) : undefined) ?? sender.frameId;
    const page = sender.tab?.url ? { url: sender.tab.url, ...(sender.tab.title ? { title: sender.tab.title } : {}) } : undefined;
    const settled = with_site_engines(request.invocations, config.search_engines, page);
    if ("unfit_letter" in settled) {
      const refusal = { id: "open.search", message: `No ${settled.unfit_letter} search for this site` };
      await router_deps.show_refusal(sender.tab?.id, refusal, sender.frameId);
      return { ok: false, refusal };
    }
    return router.run({
      invocations: settled.invocations,
      mode: request.mode,
      may_prompt: true,
      ...(request.from_hints === true && request.invocations.length === 1 && request.invocations[0]?.id === "open.url" ? { skip_repeat: true } : {}),
      ...(sender.tab?.id === undefined ? {} : { sender_tab_id: sender.tab.id }),
      ...(frame_id === undefined ? {} : { frame_id }),
      ...(!is_extension_page(sender, browser.runtime.id, browser.runtime.getURL("")) && { from_page: true }),
    });
  });
});

// No setting turns this off: a first install has no config yet, so none could apply.
browser.runtime.onInstalled.addListener(({ reason }) => {
  void open_quick_start_on_install(
    {
      reason,
      open_tab: (url) => browser.tabs.create({ url }),
    },
    (file) => browser.runtime.getURL(file),
  );
});

browser.commands.onCommand.addListener((slot_name: string) => void (async () => {
  // Before the slot table and the off gate: the toggle must work while off, and it is the only shortcut that does.
  if (slot_name === TOGGLE_COMMAND) return toolbar.toggle();
  await get_config();
  const stored = await browser.storage.local.get(SLOT_TABLE_STORAGE_KEY);
  const invocations: BoundInvocation[] | undefined = (stored[SLOT_TABLE_STORAGE_KEY] as SlotTable | undefined)?.[slot_name];
  if (!invocations) return;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const mode = active?.id === undefined ? "normal" : await tab_modes.recall(active.id);
  if (shortcut_allowed(mode, invocations, (id) => registry.get(id), await read_disabled())) await router.run({ invocations, mode, may_prompt: true });
})());

// A fake browser in a test may lack the API, and so may a Firefox without the manifest key.
if (browser.omnibox) {
  const omnibox = create_omnibox({
    registry,
    // The command line's own word lookup, so a configured alias works here too. Built after the config has loaded.
    lookup: async () => {
      const config = await get_config();
      return create_word_lookup(registry.list().map(command_meta), config.command_aliases);
    },
    get_enum_sources: async () => (await get_config(), router_deps.get_enum_sources()),
    active_tab: router_deps.active_tab,
    mode_of: async (tab_id) => (tab_id === undefined ? "normal" : tab_modes.recall(tab_id)),
    run: router.run,
    show_refusal: router_deps.show_refusal,
    completer: async () => {
      const config = await get_config();
      const keymap = (await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY))[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
      return build_completer({ commands: registry.list().map(command_meta), command_aliases: config.command_aliases, sources: await router_deps.get_enum_sources(), search_engines: config.search_engines, keymap });
    },
    record_history: cmdline.record,
  });
  browser.omnibox.setDefaultSuggestion({ description: OMNIBOX_HINT });
  browser.omnibox.onInputChanged.addListener((text, suggest) => void omnibox.changed(text, suggest).catch(warn_and_go("omnibox.changed")));
  browser.omnibox.onInputEntered.addListener((text, disposition) => void omnibox.entered(text, disposition).catch((error: unknown) => best_effort(router_deps.show_refusal(undefined, { id: "omnibox", message: error instanceof Error ? error.message : String(error) }))));
}

const site_zoom = create_site_zoom({
  session: browser.storage.session,
  level_for: make_level_for(browser.storage.local, async () => effective_settings((await get_config()).settings).zoom, read_disabled),
  address_of: (tab_id) => ignore_refusal(browser.tabs.get(tab_id)).then((tab) => tab?.url),
  set_zoom: (tab_id, level) => browser.tabs.setZoom(tab_id, level),
});

const external_editor = create_external_editor({
  session: browser.storage.session,
  client: native_host,
  send_done: (tab_id, frame_id, message) => browser.tabs.sendMessage(tab_id, message, { frameId: frame_id }),
  save_text: (text, is_private) => browser_register_store.yank("", text, is_private),
  toast: (tab_id, frame_id, message) => show_toast_on_tab({ tab_id, frame_id }, "text.edit_external", message, "error"),
  tab_exists: (tab_id) => ignore_refusal(browser.tabs.get(tab_id)).then((tab) => tab !== undefined),
  private_window_open: has_private_window,
  now: () => Date.now(),
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
const editor_ext_for = make_editor_ext_for(browser.storage.local, async () => effective_settings((await get_config()).settings).editor_ext);
void external_editor.resume().catch(warn_and_go("external_editor.resume"));

const media_quality = create_media_quality({
  is_idle: async () => (await read_disabled()) || media_quality_is_idle(browser.storage.local),
  inject_all: inject_probe_for_rule,
  inject_about_blank: inject_probe_about_blank,
  inject_frame: inject_quality_into_frame,
  frame_address,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  settle_ms: 1000,
});

browser.tabs.onUpdated.addListener((tab_id, change, tab) => void media_quality.tab_updated(tab_id, change, tab.url), { properties: ["url", "status"] });
const media_quality_settings_changed = () => void media_quality.settings_changed(() => browser.tabs.query({})).catch(warn_and_go("media_quality.settings_changed"));
media_quality_settings_changed();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && COMPILED_KEYMAP_STORAGE_KEY in changes) media_quality_settings_changed();
});

const favicon_saver = make_favicon_saver(make_favicon_cache(browser.storage.local), redraw_icon_png);
browser.tabs.onUpdated.addListener((tab_id, change, tab) => {
  // The icon often arrives after the load completes, so a later icon change saves too. A private tab saves nothing.
  if (change.status === "complete" || change.favIconUrl !== undefined) void favicon_saver.on_tab({ url: tab.url, icon: tab.favIconUrl, incognito: tab.incognito }).catch(warn_and_go("favicon_saver.on_tab"));
  // A load ends the media mode. An address change the page makes itself keeps it and drops the pin.
  if (change.url !== undefined || change.status === "loading") void tab_media.navigated(tab_id, change).catch(warn_and_go("tab_media.navigated"));
  // A new tab's first load reports only `status`, with the address already on the tab.
  if ((change.url !== undefined || change.status === "loading") && tab.url !== undefined) void site_zoom.navigated(tab_id, tab.url, tab.incognito);
  void cmdline.forget_opener_on_navigation(tab_id, change);
  if (change.status === "loading") void external_editor.orphan(tab_id).catch(warn_and_go("external_editor.orphan"));
  void jump_leave.updated({ tab_id, incognito: tab.incognito, url: tab.url, status: tab.status }, change).catch(warn_and_go("jump_leave.updated"));
  if (change.status === "loading") void inspect_relay.forget(tab_id);
  void hint_frames.navigated(tab_id, change).catch(warn_and_go("hint_frames.navigated"));
  void tab_modes.forget_on_navigation(tab_id, change);
});

browser.tabs.onRemoved.addListener((tab_id) => void jump_leave.forget(tab_id).catch(warn_and_go("jump_leave.forget")));
browser.windows.onRemoved.addListener((window_id) => void browser_jump_store.forget_window(window_id).catch(warn_and_go("browser_jump_store.forget_window")));
browser.windows.onRemoved.addListener(() => void repeat_memory.clear_private_without_window().catch(warn_and_go("repeat_memory.clear_private_without_window")));
wire_private_cleanup([browser_register_store, browser_mark_store, browser_jump_store, browser_quickmark_store, browser_macro_recorder, browser_last_played, site_zoom], browser.windows);

// Top level, so a future event page gets the events on wake. Each start of the background refills the cache from the browser history.
browser.history.onVisited.addListener(history_cache.visited);
browser.history.onTitleChanged.addListener(history_cache.title_changed);
browser.history.onVisitRemoved.addListener(history_cache.visit_removed);
browser.history.onVisitRemoved.addListener((removal) => void clear_on_history_removed(removal, { marks: browser_mark_store, cmdline, favicons: favicon_saver }).catch(warn_and_go("clear_on_history_removed")));
void history_cache.start();

browser.tabs.onActivated.addListener(({ tabId, windowId, previousTabId }) => {
  void previous_tabs.activated(windowId, previousTabId);
  void last_used_tabs.activated(tabId, windowId);
});

browser.tabs.onRemoved.addListener((tab_id, { windowId, isWindowClosing }) => {
  void external_editor.orphan(tab_id).catch(warn_and_go("external_editor.orphan"));
  void previous_tabs.removed(tab_id, windowId, isWindowClosing);
  void last_used_tabs.removed(tab_id);
  void cmdline.forget_opener(tab_id);
  void inspect_relay.forget(tab_id);
  void hint_frames.forget(tab_id).catch(warn_and_go("hint_frames.forget"));
  void tab_media.forget(tab_id).catch(warn_and_go("tab_media.forget"));
  void media_discovery.forget(tab_id).catch(warn_and_go("media_discovery.forget"));
  void tab_modes.forget(tab_id);
});

void get_config().then(() => repair_tabs_after_reload(reinject_deps));

void create_tab_model(browser_tab_model_deps({ previous_of: previous_tabs.previous_of, is_opener: cmdline.is_opener })).start();
