// Content script entry: a capture listener on keydown, the keymap from
// the background, and the modes. Runs in every frame. A frame of another site starts on its first focus.

import type { BackgroundToContent, CompiledKeymap, ContentToBackground, Mode, ModeIndicator, PageKeymap, ReadKeymap, RunResponse, TreeLeaf } from "../shared/index.ts";
import { COMPILED_KEYMAP_VERSION, DEFAULT_MODE_INDICATOR, is_freed } from "../shared/index.ts";
import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import { all_off_step } from "./site_rule.ts";
import { create_keymap_asks } from "./ask_keymap.ts";
import { message_of } from "./bundle_host.ts";
import type { BundleHostApi } from "./bundle_host.ts";
import { bundles } from "./bundles.ts";
import { deepest_focused_element, is_editable_element } from "./editable.ts";
import { shadow_root_of } from "./shadow.ts";
import { create_cancelled_keys } from "./cancelled_keys.ts";
import { create_key_flow } from "./key_flow.ts";
import { create_which_key_timer } from "./which_key_timer.ts";
import { mode_label } from "./mode_label.ts";
import { show_mode_label, show_toast } from "./ui_proxy.ts";
import { wire_mode_reports } from "./mode_report.ts";
import { page_mode } from "./page_mode.ts";
import { run_content_steps, run_in_order } from "./run_content.ts";
import { holds_keys_after, run_leaf } from "./run_leaf.ts";
import { read_context_source } from "./context.ts";
import { focus_page_content, start_content_once } from "./handlers/focus.ts";
import { read_field_text } from "./text/field_text.ts";
import { blur_focused_element } from "./handlers/page.ts";

// Until the tree is read the setting is unknown, and the default applies.
let mode_indicator: ModeIndicator = DEFAULT_MODE_INDICATOR;
let recording: string | undefined;

function refresh_mode_indicator(): void {
  const mode = page_mode.get_mode_();
  const pass_next_armed = page_mode.is_pass_next_armed_();
  show_mode_label(mode_label(mode, pass_next_armed, mode_indicator, recording), pass_next_armed ? undefined : mode);
}

const script_started_ms = performance.now();

// A cross-origin frame cannot reach the top document. The manifest injects into all frames, and such a frame starts on its first focus.
function can_reach_top_document(): boolean {
  try {
    return Boolean(window.top?.document);
  } catch {
    return false;
  }
}


async function send_to_background(message: ContentToBackground): Promise<RunResponse> {
  try {
    return (await browser.runtime.sendMessage(message)) as RunResponse;
  } catch (error) {
    return { ok: false, refusal: { id: "desertfox", message: `DesertFox background did not answer: ${message_of(error)}` } };
  }
}

// Zero turns which-key off.
let which_key_delay_ms: number | undefined;
// Hiding asks only once the bundle has loaded, because before that there is no panel.
const follow_prefix = create_which_key_timer(
  () => which_key_delay_ms,
  (prefix, is_current_, drawn_) => (prefix || bundles.has_handler_("whichkey")) && bundles.run_command_("whichkey", "whichkey", { prefix, is_current_, drawn_ }, "", false),
);

// While a macro records, a leaf starts after the one before it has ended and sent its step, so a stop key cannot overtake a step still running.
let last_leaf: Promise<unknown> = Promise.resolve();

const key_flow = create_key_flow({
  on_prefix_: follow_prefix,
  get_mode_: page_mode.get_mode_,
  take_pass_next_: page_mode.take_pass_next_,
  run_leaf_: (leaf, count, repeat) => {
    // A register paste joins the open insert session, so it must not end it.
    if (leaf.steps[0]?.invocation.id !== "register.paste") flush_typed_text();
    const run = () => run_leaf(leaf, count, repeat, send_to_background, page_mode.get_mode_, run_content_steps, show_toast);
    const ran = (last_leaf = recording === undefined ? run() : last_leaf.then(run));
    if (holds_keys_after(leaf, is_editable_element(document.activeElement))) bundles.api.hold_keys_until_(ran.then(() => []), true);
  },
  leave_insert_: () => {
    page_mode.escape();
    blur_focused_element();
  },
  in_editable_field_: () => is_editable_element(document.activeElement),
  is_loading_: bundles.is_loading_,
  loading_sink_bundles_: bundles.loading_sink_bundles_,
  sink_of_: bundles.sink_of_,
});

bundles.connect({
  request_bundle_: async (name) => (await send_to_background({ type: "load_bundle", name })).ok,
  on_idle_: key_flow.release,
  hold_first_: key_flow.hold_first_,
  set_mode_: page_mode.set_mode_,
  show_toast_: show_toast,
  // The toast needs the ui bundle, so without it an error has nowhere to show.
  show_error_: (message) => (bundles.has_handler_("ui.toast") ? show_toast(message) : console.error(message)),
  on_sink_missing_: (mode) => {
    page_mode.set_mode_("normal");
    show_toast(`${mode} mode is not available yet`);
  },
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
  if (!event.isTrusted || event.isComposing) return;
  const token = event_to_token(event);
  if (token === null) return;
  const decision = key_flow.handle_token_(token, event.repeat);
  cancelled_keys.record_keydown_(event.code, decision);
  if (decision === "cancel") cancel(event);
}

function on_keypress(event: KeyboardEvent): void {
  if (cancelled_keys.cancels_keypress_(event.code)) cancel(event);
}

function on_keyup(event: KeyboardEvent): void {
  if (cancelled_keys.take_keyup_(event.code)) cancel(event);
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
const listen = (target: EventTarget, type: string, handler: (event: never) => void, capture = true) =>
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
  watch_roots_around_focus();
  if (target instanceof Element && shadow_root_of(target)) return void setTimeout(sync_mode_to_focus);
  if (!is_editable_element(target)) return;
  if (entered) page_mode.focus_entered_editable_();
  else page_mode.focus_left_editable_();
}

// A focus move between two nodes of one root retargets both ends to the host, so the window never sees it. A listener on the root itself does. Roots are watched lazily, once focus sits in them. The shared handlers make a repeat add a no-op.
function watch_roots_around_focus(): void {
  let element = document.activeElement;
  for (let root = element && shadow_root_of(element); root; root = element && shadow_root_of(element)) {
    listen(root, "focusin", on_focusin);
    listen(root, "focusout", on_focusout);
    element = root.activeElement;
  }
}

function sync_mode_to_focus(): void {
  watch_roots_around_focus();
  if (is_editable_element(deepest_focused_element())) page_mode.focus_entered_editable_();
  else page_mode.focus_left_editable_();
}

let matcher_installed = false;
// Whether the last install matched an all-off rule. An install enters ignore mode only on the change into all-off, so a manual `,i` or `<S-Escape>` survives an unrelated edit.
let was_all_off = false;

function install_matcher(reply: PageKeymap | undefined): void {
  const keymap = reply?.keymap;
  const all_off = reply?.all_off === true;
  // A tree stored before the setting existed has no value, which means the default.
  mode_indicator = keymap?.mode_indicator ?? DEFAULT_MODE_INDICATOR;
  which_key_delay_ms = keymap?.which_key_delay_ms;
  recording = reply?.recording;
  // The mode comes first, so keys held during the load replay in the right mode.
  const first_install = !matcher_installed;
  matcher_installed = true;
  // The rule's own ignore mode ends with the rule, so removing or rewriting it takes effect on the open page.
  const step = all_off_step(keymap !== undefined, all_off, was_all_off, page_mode.get_mode_());
  if (step === "enter") page_mode.set_mode_("ignore");
  else {
    if (step === "leave") page_mode.set_mode_("normal");
    if ((first_install || step === "leave") && is_editable_element(deepest_focused_element())) page_mode.focus_entered_editable_();
  }
  if (keymap) was_all_off = all_off;
  refresh_mode_indicator();
  const frees = reply?.frees;
  const tree = keymap ?? { format_version: COMPILED_KEYMAP_VERSION, modes: {}, mode_indicator: DEFAULT_MODE_INDICATOR, which_key_delay_ms: 0 };
  key_flow.set_matcher_(create_matcher(tree, frees && ((token) => is_freed(frees, token))), keymap?.modes.browser);
  // The key test's ready signal waits for the first matcher, not for a reply that a newer ask overtook.
  if (first_install) publish_timing();
}

// The one test hook in src/: the key test reads this attribute as the content script's ready signal. Time is milliseconds.
function publish_timing(): void {
  const root = document.documentElement;
  root?.setAttribute("data-desertfox-tree-read-ms", (performance.now() - script_started_ms).toFixed(2));
}

function read_page_keymap(): Promise<PageKeymap | undefined> {
  return (browser.runtime.sendMessage({ type: "read_keymap" } satisfies ReadKeymap) as Promise<string | undefined>).then((reply) => (reply === undefined ? undefined : (JSON.parse(reply) as PageKeymap)));
}

function start(): void {
  (window as unknown as { desertfox_host: BundleHostApi }).desertfox_host = bundles.api;
  listen(window, "keydown", on_keydown);
  listen(window, "keypress", on_keypress);
  listen(window, "keyup", on_keyup);
  listen(window, "beforeinput", on_beforeinput);
  listen(window, "focusin", on_focusin);
  listen(window, "focusout", on_focusout);
  watch_roots_around_focus();
  listen(window, "pagehide", bundles.page_hidden_, false);
  listen(document, "visibilitychange", on_visibility_change, false);

  wire_mode_reports(page_mode, (mode) => {
    if (!extension_context_alive()) return stop_listening();
    key_flow.reset_sequence_();
    bundles.enter_mode_(mode);
    void send_to_background({ type: "mode_changed", mode });
  });

  // Coming back from the back-forward cache runs no start-up, and the background's per-tab mode is stale.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void send_to_background({ type: "mode_changed", mode: page_mode.get_mode_() });
  });

  page_mode.listen_display_(refresh_mode_indicator);

  const ask_keymap = create_keymap_asks(read_page_keymap, install_matcher);

  browser.runtime.onMessage.addListener((raw: unknown) => {
    const message = raw as BackgroundToContent;
    if (message.type === "ping") return Promise.resolve(true);
    if (message.type === "get_selection") return Promise.resolve(read_context_source("selection"));
    if (message.type === "focus_page") {
      focus_page_content();
      return Promise.resolve(true);
    }
    if (message.type === "run_in_content") {
      // The router already applied the count, so each invocation runs once. The router shows a failure.
      return run_in_order(message.invocations);
    } else if (message.type === "refusal") show_toast(message.refusal.message, message.kind);
    else if (message.type === "set_mode") {
      page_mode.set_mode_(message.mode);
      if (is_editable_element(deepest_focused_element())) page_mode.focus_entered_editable_();
    }
    else if (message.type === "tree_updated") void ask_keymap();
  });

  void ask_keymap();
}

start_content_once(start, window, can_reach_top_document() || document.hasFocus());
