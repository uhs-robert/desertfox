// Content script entry: a capture listener on keydown, the keymap from
// the background, and the modes. Runs in every frame. A subframe starts on its first focus.

import type { BackgroundToContent, CompiledKeymap, ContentToBackground, Mode, ModeIndicator, PageKeymap, ReadKeymap, RunResponse, TreeLeaf } from "../shared/index.ts";
import { DEFAULT_MODE_INDICATOR, is_freed } from "../shared/index.ts";
import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import { all_off_step } from "./site_rule.ts";
import { create_keymap_asks } from "./ask_keymap.ts";
import { message_of } from "./bundle_host.ts";
import type { PageHostApi } from "./bundle_host.ts";
import { bundles } from "./bundles.ts";
import { deepest_focused_element, is_editable_element, set_editable_rules } from "./editable.ts";
import { set_scroll_selector } from "./handlers/scroll.ts";
import { shadow_root_of } from "./shadow.ts";
import { create_cancelled_keys, type HeldPress } from "./cancelled_keys.ts";
import { create_key_flow, type PendingPrefix } from "./key_flow.ts";
import { cancels_keypress, cancels_keyup, press_target, replay_key_to_page } from "./replay_key.ts";
import { badge_state } from "./badge_state.ts";
import { show_mode_label, show_toast } from "./ui_proxy.ts";
import { holds_own_focus, wire_mode_reports } from "./mode_report.ts";
import { page_mode } from "./page_mode.ts";
import { fullscreen_step, takes_media_step } from "./mode_state.ts";
import { site_mode } from "./site_mode.ts";
import { run_content_steps, run_in_order } from "./run_content.ts";
import { holds_keys_after, run_leaf } from "./run_leaf.ts";
import { focus_page_content, start_content_once } from "./handlers/focus.ts";
import { read_field_text } from "./text/field_text.ts";
import { blur_focused_element, hand_focus_to_parent } from "./handlers/page.ts";

// Until the tree is read the setting is unknown, and the default applies.
let mode_indicator: ModeIndicator = DEFAULT_MODE_INDICATOR;
// Set in the top frame only, from the background, while a child frame holds focus.
let focused_frame_mode: Mode | undefined;
let recording: string | undefined;
// A macro replay holds this page's keys. Escape then stops the replay.
let replaying = false;
// The last reply, which the site mode swaps the tree of.
let page_reply: PageKeymap | undefined;

function refresh_mode_indicator(): void {
  // A child frame's pass-next flag does not reach the top frame, so the badge shows its mode alone.
  const pass_next_armed = !focused_frame_mode && page_mode.is_pass_next_armed_();
  const site_label = focused_frame_mode ? undefined : site_mode.modes_?.[site_mode.name_ ?? ""]?.label;
  show_mode_label(badge_state(focused_frame_mode ?? page_mode.get_mode_(), pass_next_armed, mode_indicator, recording, site_label));
}

const script_started_ms = performance.now();

async function send_to_background(message: ContentToBackground): Promise<RunResponse> {
  try {
    return (await browser.runtime.sendMessage(message)) as RunResponse;
  } catch (error) {
    return { ok: false, refusal: { id: "desertfox", message: `DesertFox background did not answer: ${message_of(error)}` } };
  }
}

// Zero turns which-key off.
let which_key_delay_ms: number | undefined;
let which_key_skip: readonly string[] | undefined;
// The timer lives in the `whichkey` bundle. A prefix loads it only while which-key is on, and the first panel may appear late by the load. Hiding asks only once the bundle has loaded, because before that there is no panel.
const follow_prefix = (prefix: PendingPrefix | undefined, at_once?: boolean) =>
  (prefix ? which_key_delay_ms : bundles.has_handler_("whichkey")) && bundles.run_command_("whichkey", "whichkey", { prefix, at_once, delay_ms: which_key_delay_ms, skip: which_key_skip }, "", false);

// While a macro records, a leaf starts after the one before it has ended and sent its step, so a stop key cannot overtake a step still running. A hint pick waits on the user and sends its step when it begins, so the next leaf, which may be the Escape that ends the pick, never waits for it. A replay can wait on a pick too, and its own hold keeps a later stop key behind it.
let last_leaf: Promise<unknown> = Promise.resolve();

let escape_to_page = false;

const key_flow = create_key_flow({
  on_prefix_: follow_prefix,
  get_mode_: page_mode.get_mode_,
  take_pass_next_: page_mode.take_pass_next_,
  run_leaf_: (leaf, count, repeat) => {
    // A register paste joins the open insert session, so it must not end it.
    if (leaf.steps[0]?.invocation.id !== "register.paste") flush_typed_text();
    const run = () => run_leaf(leaf, count, repeat, send_to_background, page_mode.get_mode_, run_content_steps, show_toast);
    const ran = recording === undefined ? run() : last_leaf.then(run);
    if (!leaf.steps.some((step) => /^(hint\.run|macro\.play)$/.test(step.invocation.id))) last_leaf = ran;
    if (holds_keys_after(leaf, is_editable_element(document.activeElement))) bundles.api.hold_keys_until_(ran.then(() => []), true);
  },
  leave_insert_: () => {
    page_mode.escape();
    blur_focused_element();
  },
  in_editable_field_: () => is_editable_element(deepest_focused_element()),
  escape_to_page_: () => escape_to_page,
  is_loading_: bundles.is_loading_,
  loading_sink_bundles_: bundles.loading_sink_bundles_,
  sink_of_: bundles.sink_of_,
});

bundles.connect({
  request_bundle_: async (name) => (await send_to_background({ type: "load_bundle", name })).ok,
  on_idle_: key_flow.release,
  hold_first_: key_flow.hold_first_,
  set_mode_: page_mode.set_mode_,
  escape_: page_mode.escape,
  show_toast_: show_toast,
  // The toast needs the ui bundle, so without it an error has nowhere to show.
  show_error_: (message) => (bundles.has_handler_("ui.toast") ? show_toast(message) : console.error(message)),
});

const cancelled_keys = create_cancelled_keys();

// The recorder bundle loads on the first edit in insert mode. Each call waits on that load in order, so the first edit after `gi` is not lost.
// `beforeinput` fires ahead of the edit, so the field's text then is what the recorder compares the end of the session with.
// Reads the open insert session's field, or undefined when none is open. Each session gets its own function, because the recorder's answer to an edit comes after the bundle loads, and an answer from an older session must not close a newer one.
let read_session_text: (() => string) | undefined;

function on_beforeinput(event: Event): void {
  if (!extension_context_alive()) return stop_listening();
  // Only the first edit of a session is sent, because the recorder keeps that one's text. A flush or a focusout ends the session.
  if (read_session_text || !event.isTrusted || page_mode.get_mode_() !== "insert") return;
  const field = deepest_focused_element();
  if (!field) return;
  const read_text = (read_session_text = () => read_field_text(field));
  // The field may change type while the bundle loads, so the facts that make it secret at this edit go along.
  const { type, autocomplete } = field as HTMLInputElement;
  void bundles.run_command_("text.input", "text", { field_: field, before_: read_text(), type_: type, autocomplete_: autocomplete }, "", false).then((outcome) => {
    if (outcome.ok && outcome.cancelled && read_session_text === read_text) read_session_text = undefined;
  });
}

// A command typed from the field never blurs it, so the text step is stored before the command is sent, and `.` finds the command last.
// The text is read now, at the blur or the key, because the flush may wait on the load while a page script edits the field.
// Keys wait for the flush, so a `.` right after Escape repeats this session and not the step before it.
function flush_typed_text(): void {
  if (!read_session_text) return;
  void bundles.run_command_("text.flush", "text", { after_: read_session_text() }, "");
  read_session_text = undefined;
}

function cancel(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function on_keydown(event: KeyboardEvent): void {
  if (!extension_context_alive()) return stop_listening();
  cancelled_keys.saw_keydown_(event.code);
  if (!event.isTrusted || event.isComposing) return;
  const token = event_to_token(event);
  if (token === null) return;
  // Before the key is decided, so the first key of an edit that began with no key goes to the field. The keyup call shows a change this key made itself.
  follow_field_change();
  if (replaying && token == "<Escape>") void send_to_background({ type: "replay_stop" });
  const target = press_target(event);
  const press: HeldPress = { keyup_seen_: false };
  // A replayed key the keymap passes ends the site mode after the page has the key, because ending it replays the keys behind.
  const decision = key_flow.handle_token_(token, event.repeat, () => {
    target && replay_key_to_page(event, target, press, cancelled_keys, (type, init) => new KeyboardEvent(type, init));
    site_mode.set_();
  });
  cancelled_keys.record_keydown_(event.code, decision, press);
  if (decision === "cancel") cancel(event);
  else site_mode.set_();
}

function on_keypress(event: KeyboardEvent): void {
  if (cancels_keypress(event, cancelled_keys)) cancel(event);
}

function on_keyup(event: KeyboardEvent): void {
  follow_field_change();
  if (cancels_keyup(event, cancelled_keys, page_mode.get_mode_() === "ignore" || page_reply?.keymap.off)) cancel(event);
}

const on_focusin = (event: Event) => follow_focus(true, event);
// A focus move inside one shadow root never reaches the window listener of the bundle, so this one ends the text session too. The flush is a no-op once the session is closed, so a second focusout for the same move does nothing.
const on_focusout = (event: Event) => {
  flush_typed_text();
  follow_focus(false, event);
};

// After the extension reloads, the old script's listeners still fire but its runtime is gone.
function extension_context_alive(): boolean {
  try {
    return browser.runtime.id !== undefined;
  } catch {
    return false;
  }
}

const page_listeners = new AbortController();

// Listens until `stop_listening`. Capture is the default because the key and focus listeners must run before the page's own.
const listen = (type: string, handler: (event: never) => void, capture = true, target: EventTarget = window) =>
  target.addEventListener(type, handler as EventListener, { capture, signal: page_listeners.signal });

function stop_listening(): void {
  page_listeners.abort();
}

function on_visibility_change(): void {
  if (document.hidden) bundles.page_hidden_();
}

// A closed shadow root hides its inner field from the event path, which then ends at the host. The focus settles after the event, so the mode follows it a tick later.
function follow_focus(entered: boolean, event: Event): void {
  const target = event.composedPath()[0] ?? null;
  if (entered && blur_load_focus(target)) return;
  watch_roots_around_focus();
  if (target instanceof Element && shadow_root_of(target)) return void setTimeout(sync_mode_to_focus);
  if (is_editable_element(target)) bundles.in_mode_order_(entered ? page_mode.focus_entered_editable_ : page_mode.focus_left_editable_);
}

// A focus move between two nodes of one root retargets both ends to the host, so the window never sees it. A listener on the root itself does. Roots are watched lazily, once focus sits in them. The shared handlers make a repeat add a no-op.
function watch_roots_around_focus(): void {
  let element = document.activeElement;
  for (let root = element && shadow_root_of(element); root; root = element && shadow_root_of(element)) {
    listen("focusin", on_focusin, true, root);
    listen("focusout", on_focusout, true, root);
    element = root.activeElement;
  }
}

function sync_mode_to_focus(): void {
  watch_roots_around_focus();
  bundles.in_mode_order_(is_editable_element(deepest_focused_element()) ? page_mode.focus_entered_editable_ : page_mode.focus_left_editable_);
}

// The field that held the focus at the last key, or null when the focused element took no typing.
let field_at_last_key: Element | null | undefined;

// A page can start or end typing in the focused element with no focus event (see `is_editable_element`), so each key looks again.
// The mode follows only a change, as it does for a focus event. A frame whose body is the editor keeps that body focused after Escape, and a key that forced the mode to match the focus would undo the Escape.
function follow_field_change(): void {
  const focused = deepest_focused_element();
  const field = is_editable_element(focused) ? focused : null;
  if (field !== field_at_last_key) sync_mode_to_focus();
  field_at_last_key = field;
}

// `blur_on_load`: the time the window of about 1 s ends, opened at the first install.
// A key or click gives the page user activation, which ends the window. It also counts input from before this script started, as in any subframe, which starts on its first focus.
let load_blur_ends_ms = 0;
// True when it blurred. `blur()` returns undefined, so `!` of it is true: the shortest form for the byte cap.
const blur_load_focus = (target: EventTarget | null) => Date.now() < load_blur_ends_ms && !navigator.userActivation.isActive && is_editable_element(target) && !((target as HTMLElement).blur() as unknown);

let matcher_installed = false;
// Whether the last install matched an all-off rule. An install enters ignore mode only on the change into all-off, so a manual `,i` or `<S-Escape>` survives an unrelated edit.
let was_all_off = false;

function install_matcher(reply: PageKeymap | undefined): void {
  page_reply = reply;
  site_mode.name_ = undefined;
  site_mode.modes_ = reply?.site_modes;
  const keymap = reply?.keymap;
  const all_off = reply?.all_off === true;
  // A tree stored before the setting existed has no value, which means the default.
  mode_indicator = keymap?.mode_indicator ?? DEFAULT_MODE_INDICATOR;
  which_key_delay_ms = keymap?.which_key_delay_ms;
  which_key_skip = keymap?.which_key_skip;
  recording = reply?.recording;
  escape_to_page = !!reply?.site_values?.escape_to_page;
  const was_in_field = is_editable_element(deepest_focused_element());
  set_editable_rules(reply?.site_values);
  set_scroll_selector(reply?.site_values?.scroll_selector);
  // The mode comes first, so keys held during the load replay in the right mode.
  const first_install = !matcher_installed;
  matcher_installed = true;
  // A field the page focused before the reply came already put the frame in insert mode, and the blur's focusout takes it back.
  if (first_install && reply?.site_values?.blur_on_load) {
    load_blur_ends_ms = Date.now() + 1e3;
    blur_load_focus(deepest_focused_element());
  }
  // The rule's own ignore mode ends with the rule, so removing or rewriting it takes effect on the open page.
  const step = all_off_step(keymap !== undefined, all_off, was_all_off, page_mode.get_mode_());
  if (step === "enter") bundles.set_mode_("ignore");
  // A field that took the focus while the ask was pending already put the frame in insert mode, and media must not overwrite it.
  else if (first_install && reply?.join && (reply.join === "insert" || (page_mode.get_mode_() === "normal" && !is_editable_element(deepest_focused_element())))) bundles.set_mode_(reply.join);
  else {
    if (step === "leave") bundles.set_mode_("normal");
    if ((first_install || step === "leave") && is_editable_element(deepest_focused_element())) bundles.in_mode_order_(page_mode.focus_entered_editable_);
  }
  // A page that focused its field before the rules arrived, or a rule edit, changes what the focus is. Only a change resyncs, so a manual mode stays.
  if (is_editable_element(deepest_focused_element()) !== was_in_field) sync_mode_to_focus();
  if (keymap) was_all_off = all_off;
  refresh_mode_indicator();
  install_tree();
  // The key test's ready signal waits for the first matcher, not for a reply that a newer ask overtook.
  if (first_install) publish_timing();
}

// The matcher's tree is normal mode with the running site mode's keys laid over it, so keys the mode does not bind keep their meaning.
function install_tree(): void {
  const keymap = page_reply?.keymap;
  const normal = keymap?.modes.normal;
  const overlay = site_mode.modes_?.[site_mode.name_ ?? ""];
  const tree = (keymap && overlay && normal ? { ...keymap, modes: { ...keymap.modes, normal: { ...normal, children: { ...normal.children, ...overlay.tree } } } } : keymap ?? { modes: {} }) as CompiledKeymap;
  const frees = page_reply?.frees;
  key_flow.set_matcher_(create_matcher(tree, frees && ((token) => !overlay?.tree[token] && is_freed(frees, token))), keymap?.modes.browser);
}

// The one test hook in src/: the key test reads this attribute as the content script's ready signal. Time is milliseconds.
function publish_timing(): void {
  const root = document.documentElement;
  root?.setAttribute("data-desertfox-tree-read-ms", String(performance.now() - script_started_ms));
}

function read_page_keymap(): Promise<PageKeymap | undefined> {
  return (browser.runtime.sendMessage({ type: "read_keymap", join: !matcher_installed && page_mode.get_mode_() === "normal" && !is_editable_element(deepest_focused_element()) } satisfies ReadKeymap) as Promise<string | undefined>).then((reply) => (reply === undefined ? undefined : (JSON.parse(reply) as PageKeymap)));
}

function start(): void {
  (window as unknown as { desertfox_host: PageHostApi }).desertfox_host = Object.assign(bundles.api, { is_editable_: is_editable_element });
  listen("keydown", on_keydown);
  listen("keypress", on_keypress);
  listen("keyup", on_keyup);
  listen("beforeinput", on_beforeinput);
  listen("focusin", on_focusin);
  listen("focusout", on_focusout);
  watch_roots_around_focus();
  listen("pagehide", bundles.page_hidden_, false);
  listen("visibilitychange", on_visibility_change, false, document);
  listen("mousedown", () => site_mode.set_());
  site_mode.on_change_ = () => {
    install_tree();
    refresh_mode_indicator();
  };

  // Every report says whether this frame holds the focus, so a focus event the frame missed heals on its next report.
  // A hidden input frame in normal mode then hands the focus to its parent. Every change into normal mode passes here, and so does a frame that gains the focus while in normal mode.
  // The hand-off waits a tick, because a report often runs inside a focus move that is not done. A focusout comes before the focus lands in a field of the parent, and blurring the frame there cancels the move. A window focus comes before a field focused from outside holds the focus.
  const report_mode = () => {
    setTimeout(hand_focus_to_parent);
    void send_to_background({ type: "mode_changed", mode: page_mode.get_mode_(), focus: holds_own_focus(document) });
  };

  wire_mode_reports(page_mode, (mode) => {
    if (!extension_context_alive()) return stop_listening();
    key_flow.reset_sequence_();
    site_mode.set_();
    bundles.enter_mode_(mode);
    report_mode();
  });
  // Not in capture: focus does not bubble, so only the window's own focus reaches this listener, and not that of the elements inside it.
  // Showing a tab fires focus on the top window too while a child frame holds the focus, so the report reads who holds it and does not assume this frame does.
  // No report on blur: the frame that takes the focus reports it, and a top window gets a focus event when its focused child frame is removed.
  listen("focus", report_mode, false);

  // A page shown from the back-forward cache runs no start-up, and the background's mode for the tab is stale. The report after a first load is spare, and heals a start report the background lost.
  listen("pageshow", report_mode, false);

  // A fullscreen change in this frame and the media mode of another frame take the same step.
  const media_step = (on: boolean, own?: boolean) => {
    const next = on ? fullscreen_step(page_mode.get_mode_(), true) : page_mode.media_ended_(own);
    if (next) bundles.set_mode_(next);
  };
  // On the document, where the event bubbles to. A site's own fullscreen button fires it as much as a key does.
  // The badge and an open which-key panel follow the change even when the mode stays media.
  listen(
    "fullscreenchange",
    () => {
      media_step(!!document.fullscreenElement, true);
      refresh_mode_indicator();
      key_flow.reset_sequence_();
    },
    false,
    document,
  );

  page_mode.listen_display_(refresh_mode_indicator);

  const ask_keymap = create_keymap_asks(read_page_keymap, install_matcher);

  browser.runtime.onMessage.addListener((raw: unknown) => {
    const message = raw as BackgroundToContent;
    if (message.type === "ping") return Promise.resolve(true);
    if (message.type === "focus_page") {
      focus_page_content();
      return Promise.resolve(true);
    }
    if (message.type === "run_in_content") {
      // A command's own focus, such as `gi` in a macro replay right after the load, is no page focus.
      load_blur_ends_ms = 0;
      // The router already applied the count, so each invocation runs once. The router shows a failure.
      return run_in_order(message.invocations, message.repeat);
    } else if (message.type === "replay_hold") {
      // The keys wait the whole replay, in the mode the macro leaves. They are dropped when the replay fails or stops, or when the background is gone.
      replaying = true;
      bundles.api.hold_keys_until_(send_to_background({ type: "replay_end" }).then((ended) => ((replaying = false), ended.ok || key_flow.drop_held_(), [])), true);
    } else if (message.type === "refusal") show_toast(message.refusal.message, message.kind);
    else if (message.type === "media" && takes_media_step(message, browser.runtime.getFrameId(window))) media_step(message.on);
    else if (message.type === "set_mode" && !(message.held && was_all_off)) {
      bundles.set_mode_(message.mode);
      sync_mode_to_focus();
    } else if (message.type === "frame_mode") {
      focused_frame_mode = message.mode;
      refresh_mode_indicator();
    }
    else if (message.type === "tree_updated") void ask_keymap();
  });

  void ask_keymap();
}

start_content_once(start, window, window === window.top || document.hasFocus());
