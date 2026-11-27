import type { Handlers } from "./message_table.ts";
import type { ContentRequests, MessagingBrowser } from "../shared/messages/map.ts";
import type { FocusedFrameMode, FocusPage } from "../shared/messages/tab.ts";
import { best_effort, warn_and_go } from "../shared/swallow.ts";
import { effective_settings } from "../shared/config.ts";
import { relay_plan } from "../shared/relay.ts";
import { registry } from "../shared/registry/builtin.ts";
import { bundle_loader, container_names, image_deps, read_disabled, send_to_tab } from "./browser_deps.ts";
import { run_image_action } from "./image_actions.ts";
import { hint_selectors_reply, join_mode, media_quality_reply, read_keymap_reply, rule_addresses_of, sender_at } from "./page_keymap.ts";
import { strip_patterns_for } from "./strip_patterns.ts";
import { requirement_lookup, site_engine_for, with_site_engines } from "./availability.ts";
import { list_keys } from "./list_keys.ts";
import { is_scan_request } from "./find_scan.ts";
import { answer_register_request, browser_register_store } from "./register_store.ts";
import { answer_mark_request, answer_mark_step, browser_mark_store } from "./mark_store.ts";
import { browser_quickmark_store } from "./quickmark_store.ts";
import { answer_repeat_preview } from "./repeat_memory.ts";
import { create_step_recorder, page_outcome, page_steps } from "./record_step.ts";
import { browser_macro_recorder } from "./macro_recorder.ts";
import { reply_after_hold } from "./hold_on_arrival.ts";
import { rule_for_report } from "./media_quality.ts";
import { quality_reports } from "./quality_levels.ts";
import { ext_of_request } from "./external_editor.ts";
import { hand_back_parked_frame, is_cross_origin } from "./tab_modes.ts";
import { accept_hint_timing } from "./timing_log.ts";
import { browser_timing_log } from "./timing_browser.ts";
import type { Asker } from "./complete_items.ts";
import type { LoadSender } from "./bundle_loader.ts";
import type { create_browser_module } from "./browser_module.ts";
import type { create_tab_modes } from "./tab_modes.ts";
import type { create_tab_insert } from "./tab_insert.ts";
import type { create_tab_item } from "./tab_item.ts";
import type { create_media_discovery, create_tab_media } from "./tab_media.ts";
import type { start_bridge } from "./bridge_browser.ts";
import type { create_macro_replay } from "./macro_replay.ts";
import type { create_hint_frames } from "./hint_frames.ts";
import type { create_find_scan } from "./find_scan.ts";
import type { create_external_editor, make_editor_ext_for } from "./external_editor.ts";
import type { create_jump_step } from "./jump_step.ts";
import type { create_jump_leave } from "./jump_leave.ts";
import type { create_global_mark_jump } from "./global_mark_jump.ts";
import type { create_cmdline_service } from "./cmdline_service.ts";
import type { create_complete_items } from "./complete_items.ts";
import type { create_inspect_relay } from "./inspect_relay.ts";
import type { create_open_help } from "./open_help.ts";
import type { create_repeat_memory } from "./repeat_memory.ts";
import type { create_frame_cue } from "./frame_cue.ts";
import type { create_router } from "./router.ts";
import type { create_media_quality } from "./media_quality.ts";
import type { make_router_deps } from "./browser_deps.ts";
import type { get_config, get_search_engine_names, snippets } from "./config_main.ts";

declare const browser: MessagingBrowser;

// The services main.ts builds. The handlers below only route to them.
export type ContentDeps = {
  get_config: typeof get_config;
  get_search_engine_names: typeof get_search_engine_names;
  snippets: typeof snippets;
  is_own_page: (sender: browser.runtime.MessageSender) => boolean;
  tab_modes: ReturnType<typeof create_tab_modes>;
  tab_insert: ReturnType<typeof create_tab_insert>;
  tab_item: ReturnType<typeof create_tab_item>;
  media_discovery: ReturnType<typeof create_media_discovery>;
  tab_media: ReturnType<typeof create_tab_media>;
  bridge: ReturnType<typeof start_bridge>;
  macro_replay: ReturnType<typeof create_macro_replay>;
  hint_frames: ReturnType<typeof create_hint_frames>;
  find_scan: ReturnType<typeof create_find_scan>;
  external_editor: ReturnType<typeof create_external_editor>;
  editor_ext_for: ReturnType<typeof make_editor_ext_for>;
  jump_step: ReturnType<typeof create_jump_step>;
  jump_leave: ReturnType<typeof create_jump_leave>;
  global_mark_jump: ReturnType<typeof create_global_mark_jump>;
  cmdline: ReturnType<typeof create_cmdline_service>;
  complete_items: ReturnType<typeof create_complete_items>;
  inspect_relay: ReturnType<typeof create_inspect_relay>;
  open_help: ReturnType<typeof create_open_help>;
  repeat_memory: ReturnType<typeof create_repeat_memory>;
  frame_cue: ReturnType<typeof create_frame_cue>;
  router: ReturnType<typeof create_router>;
  router_deps: ReturnType<typeof make_router_deps>;
  media_quality: ReturnType<typeof create_media_quality>;
  browser_module: Pick<ReturnType<typeof create_browser_module>, "bar_report" | "bar_active" | "bar_focus">;
  is_locked_tab: (tab_id: number) => Promise<boolean>;
};

const asker_of = (sender: browser.runtime.MessageSender): Asker | undefined => {
  const { id, windowId, incognito } = sender.tab ?? {};
  return id === undefined || windowId === undefined || sender.frameId === undefined ? undefined : { tab_id: id, frame_id: sender.frameId, window_id: windowId, incognito: incognito === true };
};

// The messages content scripts, bundles and the command line page send, one entry per type. A handler that checks its own sender or request (`inspect_pick`, `find_scan`) is `any`: the other guards can only answer nothing.
export const content_handlers = (deps: ContentDeps) => {
  const { get_config, tab_modes, tab_insert, tab_item, media_discovery, tab_media, bridge, macro_replay, hint_frames, external_editor, jump_step, jump_leave, cmdline, complete_items, inspect_relay, router, router_deps, repeat_memory } = deps;
  // The tab a sender names, in the shape the mark and jump stores read.
  const marked_tab = (sender: browser.runtime.MessageSender) => sender.tab && { incognito: sender.tab.incognito, id: sender.tab.id, window_id: sender.tab.windowId, url: sender.tab.url, frame_id: sender.frameId };
  return {
    run: {
      from: "any",
      run: (request, sender) => {
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
            return { ok: false as const, refusal };
          }
          return router.run({
            invocations: settled.invocations,
            mode: request.mode,
            may_prompt: true,
            ...(request.from_hints === true && request.invocations.length === 1 && request.invocations[0]?.id === "open.url" ? { skip_repeat: true } : {}),
            ...(sender.tab?.id === undefined ? {} : { sender_tab_id: sender.tab.id }),
            ...(frame_id === undefined ? {} : { frame_id }),
            ...(!deps.is_own_page(sender) && { from_page: true }),
          });
        });
      },
    },
    mode_changed: {
      from: "frame",
      run: (request, { tab_id, tab, frame_id, sender }) => {
        // The top frame leaving insert by any route ends the hold.
        if (frame_id === 0 && request.mode !== "insert") void tab_insert.top_frame_left_insert(tab_id, request.mode).catch(warn_and_go("tab_insert.top_frame_left_insert"));
        if (request.focus === true && frame_id !== 0) void deps.browser_module.bar_focus(tab_id, frame_id);
        void media_discovery.reported(tab_id, frame_id, request.mode).catch(warn_and_go("media_discovery.reported"));
        const report = { frame_id, mode: request.mode, focus: request.focus === true, activated: request.activated, in_field: request.in_field, cross_origin: is_cross_origin(sender.url, tab.url) };
        const { documentId: document_id } = sender as LoadSender;
        void tab_media.reported(tab_id, frame_id, request.mode, report.focus, request.step === true, document_id).catch(warn_and_go("tab_media.reported"));
        void tab_item.reported(tab_id, frame_id, request.mode, request.step === true, document_id).catch(warn_and_go("tab_item.reported"));
        // The top frame may still be loading and miss the message. Its own start report brings a fresh one.
        return tab_modes.report(tab_id, report).then(({ child_mode, child_frame, tell_top, park, parked }) => {
          // The frame that takes the focus on load is handed back through the path of `gF`. Gecko may give the focus back to the frame, and the park then ends in frame mode, as it was before parking.
          if (park) {
            const park_message = { type: "focus_page", park: true } satisfies FocusPage;
            void hand_back_parked_frame(async () => (await browser.tabs.sendMessage(tab_id, park_message, { frameId: frame_id })) === true, () => best_effort(browser.tabs.sendMessage(tab_id, park_message, { frameId: 0 })));
          }
          // The bridge shows the tab's mode, which a focused child frame or ignore mode in the top frame decides. Every top frame report publishes, as a new page's first one must, and a child frame's report does when it changed what the tab shows.
          if (frame_id === 0 || tell_top) void tab_modes.recall(tab_id).then((mode) => bridge.mode_changed(tab, mode));
          if (tell_top) void best_effort(browser.tabs.sendMessage(tab_id, { type: "frame_mode", ...(child_mode === undefined ? {} : { mode: child_mode, frame_id: child_frame }), ...(parked && { parked: true as const }) } satisfies FocusedFrameMode, { frameId: 0 }));
        });
      },
    },
    // A reply is not needed, and a bar that is not up ignores the report.
    bar_state: { from: "frame", run: (request, { tab_id, tab, frame_id }) => void deps.browser_module.bar_report(tab_id, frame_id, tab.incognito === true, request) },
    leave_tab_insert: { from: "tab", run: (_request, { tab_id }) => tab_insert.leave(tab_id) },
    load_bundle: { from: "any", run: (request, sender) => bundle_loader.answer(sender, request.name) },
    list_keys: {
      from: "any",
      run: (request, sender) => {
        const tab = sender.tab;
        const page = tab?.url ? { url: tab.url, ...(tab.title ? { title: tab.title } : {}) } : undefined;
        const located = sender_at(sender, request.url);
        return get_config().then((config) =>
          list_keys(browser.storage.local, (id) => registry.get(id), request, {
            availability: {
              page,
              requirement_of: requirement_lookup(config),
              site_engine_label_of: (invocation) => config.search_engines[site_engine_for(config.search_engines, invocation.site_search?.engines ?? [], page) ?? ""]?.label,
            },
            addresses: rule_addresses_of(located),
            registers: () => browser_register_store.items(tab?.incognito === true),
            marks: () => browser_mark_store.items(sender.url ?? "", tab?.incognito === true),
            quickmarks: () => browser_quickmark_store.table(config.quickmarks, tab?.incognito === true),
            macros: () => browser_register_store.macro_items(tab?.incognito === true),
          }),
        );
      },
    },
    read_repeat_preview: {
      from: "any",
      run: (_request, sender) => get_config().then((config) => answer_repeat_preview({ is_private: sender.tab?.incognito === true, enabled: effective_settings(config.settings).which_key_repeat }, repeat_memory, (id) => registry.get(id))),
    },
    issue_cmdline_ticket: { from: "any", run: (request, sender) => cmdline.issue_ticket(sender.tab?.id, Number.isInteger(request.target_frame) ? request.target_frame : undefined) },
    relay: {
      from: "any",
      run: (request, sender) => {
        const plan = relay_plan(request, sender.frameId);
        return plan && sender.tab?.id !== undefined ? send_to_tab(sender.tab.id, { type: "run_in_content", invocations: [plan.invocation] }, plan.frame_id) : Promise.resolve({ ok: false as const, message: "relay refused" });
      },
    },
    frame_cue: {
      from: "tab",
      run: (request, { tab_id, frame_id }) =>
        // A frame that asks names itself. The top page cannot name the frame of another site that it focuses, so its mark covers the next first focus of any frame.
        tab_modes.expect_entry(tab_id, frame_id === 0 ? undefined : frame_id).then(() => (request.toast ? deps.frame_cue(tab_id) : undefined)),
    },
    open_cmdline: { from: "any", run: (request, sender) => get_config().then(() => cmdline.open(request.ticket, sender.tab?.id, sender.frameId, sender.tab?.windowId, sender.tab, sender.tab?.incognito === true, request.mode)) },
    record_cmdline: { from: "any", run: (request, sender) => cmdline.record(request.text, sender.tab?.incognito === true) },
    complete_items: { from: "any", run: (request, sender) => complete_items.answer(request.kind, asker_of(sender)) },
    tab_rows_action: { from: "any", run: (request, sender) => complete_items.tab_rows_action(request.action, request.tab_ids, asker_of(sender), request.cookie_store_id) },
    open_help: { from: "any", run: (request, sender) => deps.open_help.open(request.command_id, sender.tab?.id, sender.frameId) },
    record_step: {
      from: "any",
      run: (request, sender) => {
        // The turn is entered before the first await, so records land in arrival order and a `.` that arrives next waits for this write.
        const origin = { is_private: sender.tab?.incognito === true, ...(request.pick === true && { from_pick: true }) };
        const checked = repeat_memory.in_turn(async (unqueued) => {
          await get_config();
          const steps = page_steps(request, (id) => registry.get(id), { search_engines: await deps.get_search_engine_names(), containers: await container_names() });
          if (steps) await create_step_recorder({ get_command: (id) => registry.get(id), repeat_memory: unqueued })(steps, page_outcome(request), origin);
          return steps;
        });
        return Promise.all([checked, browser_macro_recorder.record_page(checked, page_outcome(request), origin)]).then(() => undefined);
      },
    },
    read_keymap: {
      from: "any",
      run: (request, sender) => {
        const reply = () =>
          browser_macro_recorder
            .register_of(sender.tab?.incognito === true)
            .catch(warn_and_go("macro register_of"))
            .then(async (recording) =>
              read_keymap_reply(
                browser.storage.local,
                rule_addresses_of(sender_at(sender, request.url)),
                recording,
                sender.tab?.id === undefined || sender.frameId === undefined
                  ? undefined
                  : () => join_mode(request.join, () => tab_insert.join(sender.tab!.id!, sender.frameId!), () => tab_media.join(sender.tab!.id!, sender.frameId!, (sender as LoadSender).documentId), () => tab_item.join(sender.tab!.id!, sender.frameId!, (sender as LoadSender).documentId)),
                await deps.browser_module.bar_active(),
              ),
            );
        return reply_after_hold(macro_replay, (tab_id, frame_id) => send_to_tab(tab_id, { type: "replay_hold" }, frame_id), sender.tab?.id, sender.frameId, reply);
      },
    },
    // The part of the page's keymap that a locked page cannot read from its snapshot. The address is the browser's own for the tab. Only the insert join is exact, because the call has no document id to ask the media and item holds with.
    read_keymap_state: {
      from: "any",
      run: async (request, sender) => {
        const tab_id = sender.tab?.id;
        const address = sender.tab?.url;
        if (tab_id === undefined || address === undefined || !(await deps.is_locked_tab(tab_id))) return undefined;
        const [recording, bar, join] = await Promise.all([
          browser_macro_recorder.register_of(sender.tab?.incognito === true).catch(warn_and_go("macro register_of")),
          deps.browser_module.bar_active(),
          join_mode(request.join, () => tab_insert.join(tab_id, 0), () => Promise.resolve(false), () => Promise.resolve(false)),
        ]);
        return { address, ...(recording !== undefined && { recording }), ...(join === "insert" && { join }), ...(bar && { bar: true as const }) };
      },
    },
    replay_end: { from: "any", run: () => macro_replay.ended() },
    replay_stop: { from: "any", run: () => void macro_replay.stop() },
    find_scan: {
      from: "any",
      // A request that is no scan gets no answer. The sender's type leaves that out, because the content script always sends a well-formed scan.
      run: (request, sender) => (is_scan_request(request) ? deps.find_scan.answer(request, `${sender.tab?.id}:${sender.frameId}`) : (undefined as never)),
    },
    image_action: { from: "any", run: (request, sender) => run_image_action(image_deps, request, { incognito: sender.tab?.incognito === true, cookie_store_id: sender.tab?.cookieStoreId }) },
    inspect_pick: { from: "any", run: (_request, sender) => (sender.tab?.id === undefined ? Promise.resolve({ ok: false as const, message: "No tab to inspect" }) : inspect_relay.pick(sender.tab.id)) },
    read_hint_selectors: { from: "any", run: (request, sender) => hint_selectors_reply(browser.storage.local, sender_at(sender, request.url).url) },
    read_strip_patterns: { from: "any", run: (request) => strip_patterns_for(browser.storage.local, request.address) },
    register_read: { from: "any", run: (request, sender) => answer_register_request(browser_register_store, request, sender.tab) },
    register_write: { from: "any", run: (request, sender) => answer_register_request(browser_register_store, request, sender.tab) },
    register_yank: { from: "any", run: (request, sender) => answer_register_request(browser_register_store, request, sender.tab) },
    mark_set: { from: "any", run: (request, sender) => answer_mark_request(browser_mark_store, request, marked_tab(sender), deps.global_mark_jump) },
    mark_jump: { from: "any", run: (request, sender) => answer_mark_request(browser_mark_store, request, marked_tab(sender), deps.global_mark_jump) },
    mark_step: { from: "any", run: (request, sender) => answer_mark_step(browser_mark_store, request, sender.tab && { incognito: sender.tab.incognito }) },
    jump_push: { from: "any", run: (request, sender) => jump_step(request, marked_tab(sender)) },
    jump_step: { from: "any", run: (request, sender) => jump_step(request, marked_tab(sender)) },
    jump_leave: { from: "any", run: (request, sender) => jump_leave.leave(request, marked_tab(sender), sender.url ?? "").catch(warn_and_go("jump_leave.leave")) },
    editor_open: {
      from: "frame",
      run: (request, { tab_id, frame_id, sender }) => {
        const stamp = external_editor.navigation_stamp(tab_id);
        return get_config().then(async () => external_editor.open(tab_id, frame_id, request, await ext_of_request(request.ext, () => deps.editor_ext_for(rule_addresses_of(sender_at(sender, request.url)))), sender.tab?.incognito === true, stamp));
      },
    },
    hint_frames_start: { from: "frame", run: (request, { tab_id, frame_id }) => hint_frames.start(tab_id, frame_id, request) },
    hint_frames_report: { from: "frame", run: (request, { tab_id, frame_id }) => hint_frames.report(tab_id, frame_id, request.session_id, request.count, request.texts) },
    hint_frames_typed: { from: "frame", run: (request, { tab_id, frame_id }) => hint_frames.typed(tab_id, frame_id, request.session_id, request.typed, request.matches && { matches: request.matches, active: request.active }) },
    hint_frames_pick: { from: "frame", run: (request, { tab_id, frame_id }) => hint_frames.pick(tab_id, frame_id, request.session_id, request.label, request.keys) },
    hint_frames_end: { from: "frame", run: (request, { tab_id, frame_id }) => hint_frames.end(tab_id, frame_id, request.session_id) },
    hint_frames_unhover: { from: "frame", run: (request, { tab_id }) => hint_frames.unhover(tab_id, request.session_id) },
    media_pin: { from: "frame", run: (_request, { tab_id, frame_id }) => tab_media.pin(tab_id, frame_id) },
    quality_report: {
      from: "any",
      run: (request, sender) => {
        quality_reports.receive(sender.tab?.id, sender.frameId, request);
        return rule_for_report(request, { is_disabled: read_disabled, value_for_frame: () => media_quality_reply(browser.storage.local, sender_at(sender, request.url).url) });
      },
    },
    quality_probe: { from: "any", run: (request, sender) => deps.media_quality.probe_reported(sender.tab?.id, sender.frameId, request.address) },
    record_timing: { from: "any", run: (request) => void accept_hint_timing(browser_timing_log, request) },
    snippet_run: { from: "any", run: (request, sender) => get_config().then(() => deps.snippets.handle_call(request, { tab_id: sender.tab?.id, frame_id: sender.frameId })) },
  } satisfies Handlers<keyof ContentRequests>;
};
