import "./command_modules.ts";
import { dispatch } from "./message_table.ts";
import type { Handlers } from "./message_table.ts";
import { page_handlers } from "./page_messages.ts";
import { content_handlers } from "./content_messages.ts";
import { best_effort, ignore_refusal, refused_as, warn_and_go } from "../shared/swallow.ts";
import type { BackgroundToContent, DevtoolsHello, FocusedFrameMode, MediaStep, ToBackground } from "../shared/messages/index.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { effective_settings } from "../shared/config.ts";
import { container_names, read_disabled, container_stores, make_router_deps, page_of, reinject_deps } from "./browser_deps.ts";
import { HELP_PAGE_FILE } from "../shared/page/help_route.ts";
import { open_quick_start_on_install } from "./first_install.ts";
import { create_cmdline_service, line_key_text } from "./cmdline_service.ts";
import { create_frame_cue } from "./frame_cue.ts";
import { stored_keymap } from "./keymap_source.ts";
import { listed_by_search } from "./history_cache.ts";
import { browser_rank_service_deps, start_rank_service } from "./rank_service.ts";
import { clear_on_history_removed } from "./history_clear.ts";
import { make_favicon_cache } from "../shared/page/icon_cache.ts";
import { make_favicon_saver, redraw_icon_png } from "./favicon_saver.ts";
import { shared_previous_tabs } from "./previous_tab.ts";
import { shared_last_used_tabs } from "./last_used_tab.ts";
import { browser_discard_deps } from "./tab_discard.ts";
import { browser_complete_items_deps, create_complete_items, fallback_history } from "./complete_items.ts";
import { browser_tab_action_deps } from "./tab_actions.ts";
import { create_open_help } from "./open_help.ts";
import { mark_list_rows, quickmark_list_rows } from "../shared/mark_text.ts";
import { start_bridge } from "./bridge_browser.ts";
import { item_start_for, media_quality_is_idle } from "./page_keymap.ts";
import { track_window_focus } from "./window_focus.ts";
import { create_external_editor, make_editor_ext_for } from "./external_editor.ts";
import { create_site_zoom, make_level_for } from "./site_zoom.ts";
import { create_inspect_relay } from "./inspect_relay.ts";
import { repair_tabs_after_reload } from "./reload.ts";
import { browser_tab_model_deps, create_tab_model } from "./tab_model.ts";
import { browser_find_scan_deps, create_find_scan } from "./find_scan.ts";
import { browser_hint_frames_deps, create_hint_frames } from "./hint_frames.ts";
import { create_word_lookup } from "../shared/completion/word_lookup.ts";
import { build_completer, create_omnibox, OMNIBOX_HINT } from "./omnibox.ts";
import { create_router } from "./router.ts";
import { wire_private_cleanup } from "./store_turns.ts";
import { browser_mark_store } from "./mark_store.ts";
import { browser_quickmark_store } from "./quickmark_store.ts";
import { browser_register_store } from "./register_store.ts";
import { create_repeat_memory } from "./repeat_memory.ts";
import { create_step_recorder } from "./record_step.ts";
import type { RecordStep } from "./record_step.ts";
import { browser_macro_recorder } from "./macro_recorder.ts";
import { browser_last_played } from "./macro_last_played.ts";
import { create_macro_replay, wire_macro_replay } from "./macro_replay.ts";
import { check_play_step } from "../commands/macro.ts";
import { wire_repeat } from "../commands/command.ts";
import { wire_tab_insert } from "../commands/mode.ts";
import { wire_before_own_load } from "../commands/open_target.ts";
import { create_media_quality } from "./media_quality.ts";
import { ask_quality_in_tab, frame_address, inject_probe_about_blank, inject_probe_for_rule, inject_quality_into_frame, quality_rows } from "./quality_levels.ts";
import { tab_media } from "../commands/media.ts";
import { create_media_discovery } from "./tab_media.ts";
import { MEDIA_PANEL_HANDLER } from "../shared/bundles.ts";
import { create_tab_insert } from "./tab_insert.ts";
import { ask_item_start, create_tab_item } from "./tab_item.ts";
import { step_target, tab_steps } from "./tab_steps.ts";
import { DISABLED_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, TAB_MODE_STORAGE_PREFIX } from "../shared/config/storage_keys.ts";
import { THEME_STORAGE_KEY } from "../shared/theme/apply.ts";
import { bar_setting_on, create_browser_module, module_setting_on } from "./browser_module.ts";
import { check_args } from "../shared/registry/check_args.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { has_content_script, send_to_tab, show_toast_on_tab } from "./browser_deps.ts";
import { create_global_mark_jump } from "./global_mark_jump.ts";
import { browser_jump_store } from "./jump_store.ts";
import { create_jump_step } from "./jump_step.ts";
import { create_jump_leave } from "./jump_leave.ts";
import { watch_page_ready } from "./page_ready.ts";
import { native_host, change_edits, change_layers, get_config, get_search_engine_names, host_update, read_alias_state, read_settings_layers, read_engine_state, read_keymap_state, read_stored_files, republish, set_desktop_theme, snippets, choose_host_start, change_engine_file, import_config, preview_config_import, reload_config_at_start, reload_config, change_site_rule_in_file, change_site_keys_in_file, set_in_settings_file, set_theme_file, unset_in_settings_file, remove_snippet, save_config_file } from "./config_main.ts";
import { create_toolbar, TOGGLE_COMMAND } from "./toolbar.ts";
import { create_font_names } from "./font_names.ts";
import { missing_host_as_undefined } from "./native_client.ts";
import { canvas_measure } from "../shared/font_candidates.ts";
import { create_settings_messages } from "./settings_message.ts";
import { is_extension_page } from "./extension_page.ts";
import { create_keymap_messages } from "./keymap_message.ts";
import { create_engine_messages } from "./engine_message.ts";
import { create_alias_messages } from "./alias_message.ts";
import { built_in_theme_names } from "../shared/theme/load.ts";
import { create_theme_messages } from "./theme_message.ts";
import { create_quickmark_messages } from "./quickmark_message.ts";
import { ConfigRefusal } from "./config_reload.ts";
import { DEFAULT_KEYMAP } from "../shared/keys/default_keymap.ts";
import { command_meta } from "../shared/registry/index.ts";
import { registry } from "../shared/registry/builtin.ts";
import { create_tab_modes, shortcut_allowed } from "./tab_modes.ts";
import type { SlotTable } from "./slots.ts";

declare const browser: MessagingBrowser;

const tab_modes = create_tab_modes(browser.storage.local);
// Queued first, so the clear never removes a fresh report.
const modes_cleared = tab_modes.forget_all();
const tab_insert = create_tab_insert({
  storage: browser.storage.local,
  modes_cleared,
  send_mode: (tab_id, mode) => send_to_tab(tab_id, { type: "set_mode", mode, held: true }),
});
wire_tab_insert(tab_insert.enter);
const tab_item = create_tab_item({
  storage: browser.storage.session,
  send_step: (tab_id, on, frame_id, from, document_id) => browser.tabs.sendMessage(tab_id, { type: "media", on, from, item: true } satisfies MediaStep, step_target(frame_id, document_id)),
  steps: tab_steps,
  takes_carried_mode: async (tab_id) => {
    const top = await refused_as(browser.webNavigation.getFrame({ tabId: tab_id, frameId: 0 }), null);
    return !(await read_disabled()) && (await item_start_for(browser.storage.local, top?.url, { resume: true })) !== undefined;
  },
});
wire_before_own_load(tab_item.end_for_own_load);

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
// A load that DesertFox starts in a tab ends item mode first (`tab_item.end_for_own_load`).
const own_load = async (tab_id: number, url: string) => {
  await tab_item.end_for_own_load(tab_id);
  return browser.tabs.update(tab_id, { url });
};
const global_mark_jump = create_global_mark_jump({
  store: browser_mark_store,
  list_tabs: global_mark_tabs,
  activate_tab: (tab_id) => browser.tabs.update(tab_id, { active: true }),
  focus_window: (window_id) => browser.windows.update(window_id, { focused: true }),
  navigate: own_load,
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
  navigate: own_load,
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
const font_names = create_font_names({ storage: browser.storage.local, host_fonts: () => native_host.list_fonts().catch(missing_host_as_undefined), measure: canvas_measure });
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
    return { commands: registry.list().map(command_meta), help_ids: [...built_in_ids], command_aliases: config.command_aliases, theme_names: Object.keys(config.local_themes ?? {}).filter((name) => !built_in_theme_names().includes(name)), font_names: await refused_as(font_names.read(), []), prompt: settings.cmdline_prompt, all_windows: settings.completion_all_windows, statusbar_widgets: settings.statusbar_widgets };
  },
  key_text: async (mode) => line_key_text(current_keymap(await stored_keymap(browser.storage.local)), registry.list().map(command_meta), mode),
});

const frame_cue = create_frame_cue({
  keymap: () => stored_keymap(browser.storage.local),
  commands: () => registry.list().map(command_meta),
  toast_in_top: (tab_id, message, duration_ms) => best_effort(send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: "ui.toast", args: { message, kind: "info", duration_ms }, bundle: "ui" }] }, 0)),
});
// A frame that navigates is a new document: the line opened for the old one must not aim at it.
browser.webNavigation.onCommitted.addListener(({ tabId, frameId }) => void cmdline.forget_target_frame(tabId, frameId).catch(warn_and_go("cmdline.forget_target_frame")));
browser.webNavigation.onCommitted.addListener(({ tabId, frameId, transitionType, transitionQualifiers, url }) => void tab_item.committed(tabId, frameId, { transitionType, transitionQualifiers, url }).catch(warn_and_go("tab_item.committed")));

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

const find_scan = create_find_scan(browser_find_scan_deps());
const hint_frames = create_hint_frames({
  ...browser_hint_frames_deps(),
  parked_frame: (tab_id) => tab_modes.parked_frame(tab_id),
  unpark: async (tab_id, frame_id) => {
    const unparked = await tab_modes.unpark(tab_id, frame_id);
    if (unparked) void best_effort(browser.tabs.sendMessage(tab_id, { type: "frame_mode", ...(unparked.child_mode === undefined ? {} : { mode: unparked.child_mode, frame_id: unparked.child_frame }) } satisfies FocusedFrameMode, { frameId: 0 }));
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
const browser_module = create_browser_module({
  session: browser.storage.session,
  is_on: () => module_setting_on(browser.storage.local),
  bar_setting: () => bar_setting_on(browser.storage.local),
  read_theme: async () => (await browser.storage.local.get(THEME_STORAGE_KEY))[THEME_STORAGE_KEY],
  on_bar_change: () => void browser.tabs.query({}).then((tabs) => tabs.forEach((tab) => tab.id === undefined || void best_effort(browser.tabs.sendMessage(tab.id, { type: "tree_updated" })))).catch(warn_and_go("browser_module.on_bar_change")),
  check_args: (id, args) => {
    const command = registry.get(id);
    const checked = command && check_args(command, args);
    return checked?.ok ? checked.args : undefined;
  },
  handlers: {},
  read_disabled,
  read_keymap: () => stored_keymap(browser.storage.local),
  read_tab_records: async () => Object.fromEntries(Object.entries(await browser.storage.local.get(null)).filter(([key]) => key.startsWith(TAB_MODE_STORAGE_PREFIX))) as never,
  now: Date.now,
  later: (run, ms) => void setTimeout(run, ms),
});
browser.storage.onChanged.addListener((changes, area) => browser_module.storage_changed(changes, area));
void get_config().then(() => browser_module.sync()).catch(warn_and_go("browser_module.sync"));
const bridge = start_bridge(tab_modes.recall, router_deps, snippets.is_snippet, set_desktop_theme, host_update.bridge_ready);
const refresh_font_names = () => void refused_as(font_names.refresh(), undefined);
host_update.on_updated(() => {
  bridge.reconnect();
  refresh_font_names();
});
browser.permissions.onAdded.addListener(refresh_font_names);
// The one host read of a start: it also reports the host's version, which the bridge does not when it is off. Without the permission the client sends nothing.
void reload_config_at_start();
refresh_font_names();
const settings_messages = create_settings_messages({ change_edits, read_layers: read_settings_layers, read_theme_names: async () => Object.keys((await get_config()).local_themes ?? {}).sort(), set_in_file: set_in_settings_file, unset_in_file: unset_in_settings_file });
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
const engine_messages = create_engine_messages({ read_engine_state, change_engine_file, read_starter: read_starter_engines });
const alias_messages = create_alias_messages({ read_alias_state, change_layers });
const theme_messages = create_theme_messages({ read_files: read_stored_files, set_theme_file });
const quickmark_messages = create_quickmark_messages({ store: browser_quickmark_store, configured: async () => (await get_config()).quickmarks });
const keymap_messages = create_keymap_messages({ default_keymap: DEFAULT_KEYMAP, registry, read_keymap_state, change_layers });

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

// Listeners register in the first turn, so no event is missed while the config loads. The table sits here, below the last service it names.
const is_own_page = (sender: browser.runtime.MessageSender) => is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""));
const handlers = {
  ...page_handlers({ get_config, settings_messages, keymap_messages, engine_messages, alias_messages, theme_messages, quickmark_messages, font_names, toolbar, change_site_keys_in_file, change_site_rule_in_file, preview_config_import, import_config, read_keymap_state, read_engine_state, remove_snippet, save_config_file, choose_host_start, reload_config }),
  ...content_handlers({ get_config, get_search_engine_names, snippets, is_own_page, tab_modes, tab_insert, tab_item, media_discovery, tab_media, bridge, macro_replay, hint_frames, find_scan, external_editor, editor_ext_for, jump_step, jump_leave, global_mark_jump, cmdline, complete_items, inspect_relay, open_help, repeat_memory, frame_cue, router, router_deps, media_quality, browser_module }),
} satisfies Handlers<keyof ToBackground>;
browser.runtime.onMessage.addListener(dispatch(handlers, is_own_page));

const start_item_mode = async (tab_id: number, address: string | undefined) => {
  const resume = await tab_item.take_resume(tab_id);
  await ask_item_start({
    // After the document read, which comes first so that a reload during these reads cannot hand the start to the new document.
    start_for: async (at) => ((await read_disabled()) ? undefined : item_start_for(browser.storage.local, at, { resume })),
    top_document: (id) => refused_as(browser.webNavigation.getFrame({ tabId: id, frameId: 0 }) as Promise<{ url?: string; documentId?: string } | null>, null).then((frame) => frame ?? undefined),
    // The bundled types do not list `documentId`.
    send_start: (id, document_id, start) => best_effort(browser.tabs.sendMessage(id, { type: "run_in_content", invocations: [{ id: "item.start", args: { ...start, resume }, bundle: "item" }] } satisfies BackgroundToContent, { frameId: 0, documentId: document_id } as { frameId: number })),
  }, tab_id, address);
};

const favicon_saver = make_favicon_saver(make_favicon_cache(browser.storage.local), redraw_icon_png);
browser.tabs.onUpdated.addListener((tab_id, change, tab) => {
  // The icon often arrives after the load completes, so a later icon change saves too. A private tab saves nothing.
  if (change.status === "complete" || change.favIconUrl !== undefined) void favicon_saver.on_tab({ url: tab.url, icon: tab.favIconUrl, incognito: tab.incognito }).catch(warn_and_go("favicon_saver.on_tab"));
  // A load drops the mode steps of both modes at once, before either ends its hold (`tab_steps.ts`).
  if (change.status === "loading" && change.url === undefined) tab_steps.reset(tab_id);
  // A load ends the media mode. An address change the page makes itself keeps it and drops the pin.
  if (change.url !== undefined || change.status === "loading") void tab_media.navigated(tab_id, change).catch(warn_and_go("tab_media.navigated"));
  // At the bare `loading` the tab still shows the address it leaves.
  if (change.status === "loading") void tab_item.navigated(tab_id, change, tab.url).catch(warn_and_go("tab_item.navigated"));
  // The top frame decides whether the page holds a list. Item mode then spreads to the other frames from its report.
  if (change.status === "complete") void start_item_mode(tab_id, tab.url).catch(warn_and_go("start_item_mode"));
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

// The Worker fills its history at once. The listeners are top level, so a future event page gets the events on wake.
const rank_service = start_rank_service(
  browser_rank_service_deps({
    inputs: complete_items.rank_inputs,
    is_opener: cmdline.is_opener,
    fallback: fallback_history,
    listed: (url) => listed_by_search((text) => browser.history.search({ text, startTime: 0, maxResults: 20 }), url),
  }),
);
browser.runtime.onConnect.addListener(rank_service.connect);
browser.history.onVisited.addListener(rank_service.visited);
browser.history.onTitleChanged.addListener(rank_service.title_changed);
browser.history.onVisitRemoved.addListener(rank_service.visit_removed);
browser.history.onVisitRemoved.addListener((removal) => void clear_on_history_removed(removal, { marks: browser_mark_store, cmdline, favicons: favicon_saver }).catch(warn_and_go("clear_on_history_removed")));

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
  tab_steps.reset(tab_id);
  void tab_media.forget(tab_id).catch(warn_and_go("tab_media.forget"));
  void tab_item.forget(tab_id).catch(warn_and_go("tab_item.forget"));
  void media_discovery.forget(tab_id).catch(warn_and_go("media_discovery.forget"));
  void tab_modes.forget(tab_id);
});

void get_config().then(() => repair_tabs_after_reload(reinject_deps));

void create_tab_model(browser_tab_model_deps({ previous_of: previous_tabs.previous_of, is_opener: cmdline.is_opener })).start();
