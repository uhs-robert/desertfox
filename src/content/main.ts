// Content script entry: a capture listener on keydown, the keymap from
// the background, and the modes. Runs in every frame. A subframe starts on its first focus.

import type { BackgroundToContent, CompiledKeymap, ContentToBackground, Mode, ModeIndicator, PageKeymap, ReadKeymap, RunResponse } from "../shared/index.ts";
import { DEFAULT_MODE_INDICATOR, is_freed } from "../shared/index.ts";
import { KEY_TEST_BUILD } from "../shared/key_test_build.ts";
import { create_matcher, event_to_token, physical_token } from "../shared/keys/index.ts";
import { all_off_step } from "./site_rule.ts";
import { create_keymap_asks } from "./ask_keymap.ts";
import { message_of } from "./bundle_host.ts";
import type { PageHostApi } from "./bundle_host.ts";
import { keep_chain } from "../shared/swallow.ts";
import { bundles } from "./bundles.ts";
import { deepest_focused_element, is_editable_element, set_editable_rules } from "./editable.ts";
import { scroll_by, set_scroll_selector } from "./handlers/scroll.ts";
import { shadow_root_of } from "./shadow.ts";
import { create_cancelled_keys, type HeldPress } from "./cancelled_keys.ts";
import { create_key_flow, type PendingPrefix } from "./key_flow.ts";
import { follow_which_key } from "./gate.ts";
import { cancels_keypress, cancels_keyup, press_target, replay_key_to_page } from "./replay_key.ts";
import { badge_state } from "./badge_state.ts";
import { DEFAULT_GRAB_STEP_PX } from "../shared/default_settings.ts";
import { set_toast_durations, show_mode_label, show_toast } from "./ui_proxy.ts";
import { holds_own_focus, wire_mode_reports } from "./mode_report.ts";
import { page_mode } from "./page_mode.ts";
import { fullscreen_step, takes_media_step } from "./mode_state.ts";
import { site_mode } from "./site_mode.ts";
import { run_content_steps, run_in_order } from "./run_content.ts";
import { holds_keys_after, run_leaf } from "./run_leaf.ts";
import { leaf_for_page } from "./leaf_for_page.ts";
import { answer_park, focus_page_content, start_content_once } from "./handlers/focus.ts";
import { read_field_text } from "./lib/field_text.ts";
import { blur_focused_element, hand_focus_to_parent } from "./handlers/page.ts";

declare const browser: MessagingBrowser;

// Until the tree is read the setting is unknown, and the default applies.
let mode_indicator: ModeIndicator = DEFAULT_MODE_INDICATOR;
// Set in the top frame only, from the background, while a child frame holds focus.
let focused_frame_mode: Mode | undefined;
let focused_frame = 0;
// A frame of another site was handed back to this page, so the hints label its targets too.
let frame_parked = false;
let recording: string | undefined;
// The size of the range of visual item mode by frame (0 for this frame's own), set by the item bundle. The top frame shows the focused frame's, so a frame without the focus that changes its range does not take the badge.
const visual_counts: (number | undefined)[] = [];
// A macro replay holds this page's keys. Escape then stops the replay.
let replaying = false;
// The last reply, which the site mode swaps the tree of.
let page_reply: PageKeymap | undefined;

function refresh_mode_indicator(): void {
  // A child frame's pass-next flag does not reach the top frame, so the badge shows its mode alone.
  const pass_next_armed = !focused_frame_mode && page_mode.is_pass_next_armed_();
  // A subframe that holds the focus in normal mode shows FRAME, so the user sees the keys act there.
  const site_label = focused_frame_mode ? "FRAME" : site_mode.modes_?.[site_mode.name_ ?? ""]?.label;
  show_mode_label(bar_on ? undefined : badge_state(focused_frame_mode ?? page_mode.get_mode_(), pass_next_armed, mode_indicator, recording, site_label, visual_counts[focused_frame]));
  bar_flags = { ...(pass_next_armed && { pass: true as const }), ...(site_label && { site: site_label }) };
  report_bar();
}

// The browser module's status bar is up, so the badge stays hidden and the bar hears what it shows. Only a change is sent.
let bar_on = false;
let bar_pending: PendingPrefix | undefined;
let bar_sent = "";
let bar_flags: { pass?: true; site?: string } = {};
function report_bar(): void {
  if (!bar_on) return;
  const { typed_ = [], count_ } = bar_pending ?? {};
  const keys = { ...(typed_.length && { pending: typed_ }), ...(count_ && { count: count_ }) };
  // A child frame that holds the focus reports its own keys, so the top frame's say nothing about them.
  const message = { type: "bar_state", ...(focused_frame_mode ? { child: true as const } : keys), ...(window === window.top && { ...bar_flags, ...(recording && { recording }) }) } satisfies ContentToBackground;
  const text = JSON.stringify(message);
  if (text === bar_sent) return;
  bar_sent = text;
  // A report that failed is sent again at the next identical one.
  void send_to_background(message).then((reply) => reply?.ok === false && (bar_sent = ""));
}

const script_started_ms = KEY_TEST_BUILD ? performance.now() : 0;

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
// The timer lives in the `whichkey` bundle, so the first panel may appear late by the load.
const follow_prefix = (prefix: PendingPrefix | undefined, at_once?: boolean) => {
  bar_pending = prefix;
  report_bar();
  follow_which_key(bundles, prefix?.typed_.length ? prefix : undefined, at_once, which_key_delay_ms, which_key_skip);
};

// While a macro records, a leaf starts after the one before it has ended and sent its step, so a stop key cannot overtake a step still running. A hint pick waits on the user and sends its step when it begins, so the next leaf, which may be the Escape that ends the pick, never waits for it. A replay can wait on a pick too, and its own hold keeps a later stop key behind it.
let last_leaf: Promise<unknown> = Promise.resolve();
// The leaf that ran last, hint leaves included. A bundle that holds keys behind its own pick waits for its end through `leaf_end_`.
let leaf_ran: Promise<unknown> = Promise.resolve();

let escape_to_page = false;

const key_flow = create_key_flow({
  on_prefix_: follow_prefix,
  get_mode_: page_mode.get_mode_,
  take_pass_next_: page_mode.take_pass_next_,
  run_leaf_: (bound_leaf, count, repeat) => {
    const leaf = leaf_for_page(bound_leaf, document.activeElement, document.body, document);
    // No leaf runs when every guard fails and nothing is left to fall back to: the page keeps the key.
    if (!leaf) return true;
    // A register paste joins the open insert session, so it must not end it.
    if (leaf.steps[0]?.invocation.id !== "register.paste") flush_typed_text();
    const run = () => run_leaf(leaf, count, repeat, send_to_background, page_mode.get_mode_, run_content_steps, show_toast);
    const ran = (leaf_ran = recording === undefined ? run() : last_leaf.then(run));
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

// Counts the keys a person pressed, bound or not. The content script takes a bound key before any bundle listener sees it, so a load that waits on the user reads this count.
let pressed_keys = 0;

function on_keydown(event: KeyboardEvent): void {
  if (!extension_context_alive()) return stop_listening();
  cancelled_keys.saw_keydown_(event.code);
  if (!event.isTrusted) return;
  // Before the token filter: a key that starts a composition or has no token (Dead, Process) is the user typing too. A held key's repeats and a modifier alone are not.
  if (!event.repeat && !/^(Shift|Control|Alt|Meta|AltGraph|OS|CapsLock)$/.test(event.key)) end_blur();
  if (event.isComposing) return;
  const token = event_to_token(event);
  if (token === null) return;
  if (!event.repeat) pressed_keys++;
  // Before the key is decided, so the first key of an edit that began with no key goes to the field. The keyup call shows a change this key made itself.
  follow_field_change();
  if (replaying && token == "<Escape>") void send_to_background({ type: "replay_stop" });
  const target = press_target(event);
  const press: HeldPress = { keyup_seen_: false };
  // A replayed key the keymap passes ends the site mode after the page has the key, because ending it replays the keys behind.
  const decision = key_flow.handle_token_(
    token,
    event.repeat,
    () => {
      target && replay_key_to_page(event, target, press, cancelled_keys, (type, init) => new KeyboardEvent(type, init));
      site_mode.end_on_input_();
    },
    physical_token(event),
  );
  cancelled_keys.record_keydown_(event.code, decision, press);
  if (decision === "cancel") cancel(event);
  else site_mode.end_on_input_();
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

// Showing the tab again opens a switch window: a page such as a chat app focuses its prompt each time it is shown.
function on_visibility_change(): void {
  if (!document.hidden) return void (page_reply?.site_values?.blur_on_load && open_blur(true));
  end_blur();
  bundles.page_hidden_();
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

// `blur_on_load`: the time the window of about 1 s ends, opened at the first install and each time the tab is shown again.
// A key that is no repeat, a mouse press, a command run here or the tab going hidden ends it.
// User activation is no input: the repeats of a held Shift+J give activation to each tab they pass, a tab that loads as it is shown included.
// A subframe's load window is the exception: its script starts on its first focus, so the click that gave it is only seen as activation.
let blur_ends_ms = 0;
let blur_by_switch = false;
// A few blurs per window: a page that takes the focus back after them keeps the field, as with the setting off, so no blur and refocus loop runs.
// One is too few: a chat page focuses its prompt on the show and again on the window focus, two moves of one switch.
const BLURS_PER_WINDOW = 5;
let blurs_left = 0;
// The focus_on_load element this window focused, whose own focusin is no page focus.
let load_focus_given: Element | null = null;
const end_blur = () => (blur_ends_ms = 0);
// Whether a click or key has reached this window.
const activated = (): boolean => navigator.userActivation.hasBeenActive;

// `focus_on_load`: the element that takes the focus in place of the blur. A selector that does not parse finds nothing, and so does the empty default.
let load_focus_selector = "";
const load_focus_target = (): HTMLElement | null => {
  try {
    return document.querySelector(load_focus_selector);
  } catch {
    return null;
  }
};

// Body stands for no focus, so the target can take the focus before the page focuses anything.
// True when it blurred or moved the focus. A switch only blurs: focus_on_load is for loads.
const blur_load_focus = (target: EventTarget | null) => {
  if (Date.now() >= blur_ends_ms || (!blur_by_switch && window !== window.top && navigator.userActivation.isActive) || !(target === document.body || is_editable_element(target))) return false;
  if (target === load_focus_given) return true;
  // A page that refocuses inside its blur handler fires this focusin before the blur's focusout, so the mode follows the focus once both have run.
  if (blurs_left < 1) return end_blur(), setTimeout(sync_mode_to_focus), false;
  const wanted = !blur_by_switch && load_focus_target();
  // Counted before the blur: a page can refocus inside its own blur handler, and that focus must find the count already lowered.
  if (target !== document.body) blurs_left--;
  wanted ? (load_focus_given = wanted).focus() : (target as HTMLElement).blur();
  return true;
};

const open_blur = (by_switch: boolean) => {
  blur_by_switch = by_switch;
  blurs_left = BLURS_PER_WINDOW;
  load_focus_given = null;
  blur_ends_ms = Date.now() + 1e3;
  blur_load_focus(deepest_focused_element());
};

let matcher_installed = false;
// Whether the last install matched an all-off rule. An install enters ignore mode only on the change into all-off, so a manual `,i` or `<S-Escape>` survives an unrelated edit.
let was_all_off = false;

let grab_step_px: number = DEFAULT_GRAB_STEP_PX;

function install_matcher(reply: PageKeymap | undefined): void {
  // The same answer as the last one, which only an address change inside one row asks for. Installing again would end a running site mode.
  const text = reply && reply_text.get(reply);
  if (matcher_installed && text !== undefined && text === installed_text) return;
  installed_text = text;
  page_reply = reply;
  site_mode.name_ = undefined;
  site_mode.modes_ = reply?.site_modes;
  const keymap = reply?.keymap;
  const all_off = reply?.all_off === true;
  // A tree stored before the setting existed has no value, which means the default.
  mode_indicator = keymap?.mode_indicator ?? DEFAULT_MODE_INDICATOR;
  if (bar_on !== (keymap?.bar === true)) bar_sent = "";
  bar_on = keymap?.bar === true;
  which_key_delay_ms = keymap?.which_key_delay_ms;
  key_flow.set_layout_fallback_(keymap?.layout_fallback !== false);
  set_toast_durations(keymap);
  grab_step_px = keymap?.grab_step_px ?? DEFAULT_GRAB_STEP_PX;
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
  if (first_install && (reply?.site_values?.blur_on_load || reply?.site_values?.focus_on_load)) {
    load_focus_selector = reply.site_values.focus_on_load ?? "";
    open_blur(false);
  }
  // The rule's own ignore mode ends with the rule, so removing or rewriting it takes effect on the open page.
  const step = all_off_step(keymap !== undefined, all_off, was_all_off, page_mode.get_mode_());
  if (step === "enter") void bundles.set_mode_("ignore");
  // A field that took the focus while the ask was pending already put the frame in insert mode, and media must not overwrite it.
  else if (first_install && reply?.join && (reply.join === "insert" || (page_mode.get_mode_() === "normal" && !is_editable_element(deepest_focused_element())))) {
    media_by_step = true;
    void bundles.set_mode_(reply.join);
  }
  else {
    if (step === "leave") void bundles.set_mode_("normal");
    if ((first_install || step === "leave") && is_editable_element(deepest_focused_element())) bundles.in_mode_order_(page_mode.focus_entered_editable_);
  }
  // A page that focused its field before the rules arrived, or a rule edit, changes what the focus is. Only a change resyncs, so a manual mode stays.
  if (is_editable_element(deepest_focused_element()) !== was_in_field) sync_mode_to_focus();
  if (keymap) was_all_off = all_off;
  refresh_mode_indicator();
  install_tree();
  // The key test's ready signal waits for the first matcher, not for a reply that a newer ask overtook.
  // The one test hook in src/, set only in the key-test build: a page can read it. Time is milliseconds.
  if (KEY_TEST_BUILD && first_install) document.documentElement?.setAttribute("data-desertfox-tree-read-ms", String(performance.now() - script_started_ms));
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

// The answer text of each parsed reply, and of the one installed. An address change asks again and gets the same text from the newest ask, however an overtaken ask resolved meanwhile.
const reply_text = new WeakMap<PageKeymap, string>();
let installed_text: string | undefined;

function read_page_keymap(): Promise<PageKeymap | undefined> {
  return browser.runtime.sendMessage({ type: "read_keymap", join: !matcher_installed && page_mode.get_mode_() === "normal" && !is_editable_element(deepest_focused_element()), url: location.href } satisfies ReadKeymap).then((reply) => {
    if (reply === undefined) return undefined;
    const keymap = JSON.parse(reply) as PageKeymap;
    reply_text.set(keymap, reply);
    return keymap;
  });
}

// The media mode of this frame came from another frame (a step, or the join reply of a late frame), not from its own fullscreen or a ;M pick. The background then knows that the report it causes may belong to a hold that already ended.
let media_by_step = false;

function start(): void {
  (window as unknown as { desertfox_host: PageHostApi }).desertfox_host = Object.assign(bundles.api, { is_editable_: is_editable_element, grab_step_px_: () => grab_step_px, pressed_keys_: () => pressed_keys, frame_parked_: () => frame_parked, scroll_by_: scroll_by, focused_: deepest_focused_element, leaf_end_: () => keep_chain(leaf_ran), visual_count_: (count: number | undefined, frame_id = 0) => ((visual_counts[frame_id] = count), refresh_mode_indicator()) });
  listen("keydown", on_keydown);
  listen("keypress", on_keypress);
  listen("keyup", on_keyup);
  listen("beforeinput", on_beforeinput);
  listen("focusin", on_focusin);
  listen("focusout", on_focusout);
  watch_roots_around_focus();
  listen("pagehide", bundles.page_hidden_, false);
  listen("visibilitychange", on_visibility_change, false, document);
  listen("mousedown", (event: MouseEvent) => (event.isTrusted && end_blur(), site_mode.end_on_input_()));
  site_mode.on_change_ = () => {
    install_tree();
    refresh_mode_indicator();
  };

  // Every report says whether this frame holds the focus, so a focus event the frame missed heals on its next report.
  // A hidden input frame in normal mode then hands the focus to its parent. Every change into normal mode passes here, and so does a frame that gains the focus while in normal mode.
  // The hand-off waits a tick, because a report often runs inside a focus move that is not done. A focusout comes before the focus lands in a field of the parent, and blurring the frame there cancels the move. A window focus comes before a field focused from outside holds the focus.
  // A frame with no click or key yet reports a task late, with the claim it had when the report was asked for: its window focus comes before the focus of its element, and the background parks a frame that is not on a field.
  // One late report covers the several that one focus event starts, because the background reads a second claim as the frame taking the focus back from its park. The claim is the one made when the report was asked for or the one at send time: the focus can slip away in that task, and the document can get it only in that task.
  let late_claim = false;
  let late_pending = false;
  const report_mode = () => {
    setTimeout(hand_focus_to_parent);
    const send = (focus: boolean) => void send_to_background({ type: "mode_changed", mode: page_mode.get_mode_(), focus, step: media_by_step, activated: activated(), in_field: is_editable_element(deepest_focused_element()) });
    if (window === window.top || activated()) return send(holds_own_focus(document));
    late_claim = holds_own_focus(document);
    if (!late_pending) (late_pending = true), setTimeout(() => ((late_pending = false), send(late_claim || holds_own_focus(document))));
  };

  wire_mode_reports(page_mode, (mode) => {
    if (!extension_context_alive()) return stop_listening();
    if ((mode !== "media" && mode !== "item") || page_mode.is_escaping_()) media_by_step = false;
    key_flow.reset_sequence_();
    site_mode.set_();
    bundles.enter_mode_(mode);
    report_mode();
  });
  // Not in capture: focus does not bubble, so only the window's own focus reaches this listener, and not that of the elements inside it.
  // Showing a tab fires focus on the top window too while a child frame holds the focus, so the report reads who holds it and does not assume this frame does.
  // A child frame also reports on blur, so its claim on the focus ends. A claim it sent from a field's blur can reach the background after the report of the frame that took the focus, which would leave the badge on FRAME.
  // The top frame needs no blur report: the frame that takes the focus reports it, and a top window gets a focus event when its focused child frame is removed.
  listen("focus", report_mode, false);
  if (window !== window.top) listen("blur", report_mode, false);
  // A hold lives in one frame and one page, so it ends when the focus leaves the frame or the page goes into the back-forward cache.
  for (const type of ["blur", "pagehide"]) listen(type, () => void key_flow.end_hold_(), false);

  // A page shown from the back-forward cache runs no start-up, and the background's mode for the tab is stale. The report after a first load is spare, and heals a start report the background lost.
  listen("pageshow", report_mode, false);

  // A fullscreen change in this frame and the media mode of another frame take the same step.
  const media_step = (on: boolean, own?: boolean, item?: true) => {
    const held = item && "item";
    const next = on ? fullscreen_step(page_mode.get_mode_(), true, held) : page_mode.media_ended_(own, held);
    if (next) {
      media_by_step = !own;
      void bundles.set_mode_(next);
    }
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
      if (message.park) {
        const free = answer_park(window === window.top, document.activeElement, activated());
        // A frame the user clicked after the park was decided says so at once, so the background ends the park and the badge shows FRAME.
        // A frame that already lost the focus says so too: Firefox can hand the load focus to the top page before this script starts, with no blur event, and only a blur report lets a later hint into the frame end the park.
        if (!free || !holds_own_focus(document)) report_mode();
        return Promise.resolve(free);
      }
      focus_page_content();
      return Promise.resolve(true);
    }
    if (message.type === "run_in_content") {
      // A command's own focus, such as `gi` in a macro replay right after the load, is no page focus.
      end_blur();
      // The router already applied the count, so each invocation runs once. The router shows a failure.
      return run_in_order(message.invocations, message.repeat);
    } else if (message.type === "replay_hold") {
      // The keys wait the whole replay, in the mode the macro leaves. They are dropped when the replay fails or stops, or when the background is gone.
      replaying = true;
      bundles.api.hold_keys_until_(send_to_background({ type: "replay_end" }).then((ended) => ((replaying = false), ended.ok || key_flow.drop_held_(), [])), true);
    } else if (message.type === "refusal") show_toast(message.refusal.message, message.kind);
    else if (message.type === "media" && takes_media_step(message, browser.runtime.getFrameId(window))) media_step(message.on, undefined, message.item);
    else if (message.type === "set_mode" && !(message.held && was_all_off)) {
      void bundles.set_mode_(message.mode);
      sync_mode_to_focus();
    } else if (message.type === "frame_mode") {
      focused_frame_mode = message.mode;
      focused_frame = message.frame_id ?? 0;
      frame_parked = message.parked === true;
      // Only the top frame hears `frame_mode`. Its watch on the focused child frame lives in the ui bundle, loaded when a child first takes the focus.
      if (message.mode || bundles.has_handler_("ui.frame_watch")) void bundles.run_command_("ui.frame_watch", "ui", { on: !!message.mode }, "", false);
      refresh_mode_indicator();
    }
    else if (message.type === "tree_updated") {
      // A keymap update installs even an identical answer: it ends a running site mode.
      installed_text = undefined;
      void ask_keymap();
    }
  });

  void ask_keymap();

  // The ask carries `location.href`, so an in-place address change (pushState, history traversal, a hash change) needs only a new ask. An answer identical to the last one installs nothing.
  let asked_address = location.href;
  (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener("currententrychange", () => {
    if (location.href === asked_address) return;
    asked_address = location.href;
    void ask_keymap();
  });
}

start_content_once(start, window, window === window.top || document.hasFocus());
