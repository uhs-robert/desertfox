// Content script entry: a capture listener on keydown, the compiled keymap from
// storage, and the modes. Runs in every frame. A frame of another site starts on its first focus.

import type { BackgroundToContent, CompiledKeymap, ContentToBackground, Mode, ModeIndicator, ReadTabAddress, RunResponse, TreeLeaf } from "../shared/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION, DEFAULT_MODE_INDICATOR, current_keymap } from "../shared/index.ts";
import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import { ignores_any_address } from "../shared/match_pattern.ts";
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
import { counted_invocations, run_content_steps, run_in_order } from "./run_content.ts";
import { read_context_source } from "./context.ts";
import { focus_page_content, start_content_once } from "./handlers/focus.ts";
import { blur_focused_element } from "./handlers/page.ts";

// Until the tree is read the setting is unknown, and the default applies.
let mode_indicator: ModeIndicator = DEFAULT_MODE_INDICATOR;

function refresh_mode_indicator(): void {
  const mode = page_mode.get_mode();
  const pass_next_armed = page_mode.is_pass_next_armed();
  show_mode_label(mode_label(mode, pass_next_armed, mode_indicator), pass_next_armed ? undefined : mode);
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

// A leaf with a background step goes to the router whole: it reads the active tab at each step, so a step after tab.next runs in the new tab.
// A leaf of content steps runs here and shows its own failure.
async function run_leaf(leaf: TreeLeaf, count: number | undefined, repeat: boolean): Promise<void> {
  if (leaf.steps.some((step) => step.runs_in === "background")) {
    // The background shows a refusal itself.
    await send_to_background({ type: "run", invocations: counted_invocations(leaf.steps, count), mode: page_mode.get_mode() });
    return;
  }
  const outcome = await run_content_steps(leaf.steps, count, repeat);
  if (!outcome.ok) show_toast(outcome.message);
}

// Zero turns which-key off.
let which_key_delay_ms: number | undefined;
// Hiding asks only once the bundle has loaded, because before that there is no panel.
const follow_prefix = create_which_key_timer(
  () => which_key_delay_ms,
  (prefix, is_current) => (prefix || bundles.has_handler("whichkey")) && bundles.run_command("whichkey", "whichkey", { prefix, is_current }, "", false),
);

const key_flow = create_key_flow({
  on_prefix: follow_prefix,
  get_mode: page_mode.get_mode,
  take_pass_next: page_mode.take_pass_next,
  run_leaf: (leaf, count, repeat) => void run_leaf(leaf, count, repeat),
  leave_insert: () => {
    page_mode.escape();
    blur_focused_element();
  },
  in_editable_field: () => is_editable_element(document.activeElement),
  is_loading: bundles.is_loading,
  sink_of: bundles.sink_of,
});

bundles.connect({
  request_bundle: async (name) => (await send_to_background({ type: "load_bundle", name })).ok,
  on_idle: key_flow.release,
  set_mode: page_mode.set_mode,
  show_toast,
  // The toast needs the ui bundle, so without it an error has nowhere to show.
  show_error: (message) => (bundles.has_handler("ui.toast") ? show_toast(message) : console.error(message)),
  on_sink_missing: (mode) => {
    page_mode.set_mode("normal");
    show_toast(`${mode} mode is not available yet`);
  },
});

const cancelled_keys = create_cancelled_keys();

function cancel(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function on_keydown(event: KeyboardEvent): void {
  if (!extension_context_alive()) return stop_listening();
  if (!event.isTrusted || event.isComposing) return;
  const token = event_to_token(event);
  if (token === null) return;
  const decision = key_flow.handle_token(token, event.repeat);
  cancelled_keys.record_keydown(event.code, decision);
  if (decision === "cancel") cancel(event);
}

function on_keypress(event: KeyboardEvent): void {
  if (cancelled_keys.cancels_keypress(event.code)) cancel(event);
}

function on_keyup(event: KeyboardEvent): void {
  if (cancelled_keys.take_keyup(event.code)) cancel(event);
}

const on_focusin = (event: Event) => follow_focus(true, event);
const on_focusout = (event: Event) => follow_focus(false, event);

// After the extension reloads, the old script's listeners still fire but its runtime is gone.
function extension_context_alive(): boolean {
  try {
    return browser.runtime.id !== undefined;
  } catch {
    return false;
  }
}

const page_listeners = new AbortController();

function stop_listening(): void {
  page_listeners.abort();
}

function on_visibility_change(): void {
  if (document.hidden) bundles.page_hidden();
}

// A closed shadow root hides its inner field from the event path, which then ends at the host. The focus settles after the event, so the mode follows it a tick later.
function follow_focus(entered: boolean, event: Event): void {
  const target = event.composedPath()[0] ?? null;
  if (target instanceof Element && shadow_root_of(target)) return void setTimeout(sync_mode_to_focus);
  if (!is_editable_element(target)) return;
  if (entered) page_mode.focus_entered_editable();
  else page_mode.focus_left_editable();
}

function sync_mode_to_focus(): void {
  if (is_editable_element(deepest_focused_element())) page_mode.focus_entered_editable();
  else page_mode.focus_left_editable();
}

let matcher_installed = false;
// The first usable tree decides ignore mode, whether it came at load or later through `tree_updated` (after an upgrade).
let ignore_checked = false;

// A frame of another site cannot read the tab's address, so it asks the background.
function read_tab_address(): Promise<string | undefined> {
  if (can_reach_top_document()) return Promise.resolve(window.top?.location.href);
  return browser.runtime.sendMessage({ type: "read_tab_address" } satisfies ReadTabAddress).then((address) => address as string | undefined, () => undefined);
}

function install_matcher(keymap: CompiledKeymap | undefined, tab_address: string | undefined): void {
  const usable = current_keymap(keymap);
  // A tree stored before the setting existed has no value, which means the default.
  mode_indicator = usable?.mode_indicator ?? DEFAULT_MODE_INDICATOR;
  which_key_delay_ms = usable?.which_key_delay_ms;
  // The mode comes first, so keys held during the load replay in the right mode.
  const first_install = !matcher_installed;
  matcher_installed = true;
  const first_usable = usable !== undefined && !ignore_checked;
  if (usable) ignore_checked = true;
  if (first_usable && ignores_any_address(usable.ignore_regex, [location.href, tab_address])) page_mode.set_mode("ignore");
  else if (first_install && is_editable_element(deepest_focused_element())) page_mode.focus_entered_editable();
  refresh_mode_indicator();
  key_flow.set_matcher(create_matcher(usable ?? { format_version: COMPILED_KEYMAP_VERSION, modes: {}, mode_indicator: DEFAULT_MODE_INDICATOR, which_key_delay_ms: 0 }), usable?.modes.browser);
}

async function read_keymap(): Promise<CompiledKeymap | undefined> {
  const stored = await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY);
  return stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
}

// The one test hook in src/: the key test reads this attribute as the content script's ready signal. Time is milliseconds.
function publish_timing(): void {
  const root = document.documentElement;
  root?.setAttribute("data-desertfox-tree-read-ms", (performance.now() - script_started_ms).toFixed(2));
}

function start(): void {
  (window as unknown as { desertfox_host: BundleHostApi }).desertfox_host = bundles.api;
  const { signal } = page_listeners;
  window.addEventListener("keydown", on_keydown, { capture: true, signal });
  window.addEventListener("keypress", on_keypress, { capture: true, signal });
  window.addEventListener("keyup", on_keyup, { capture: true, signal });
  window.addEventListener("focusin", on_focusin, { capture: true, signal });
  window.addEventListener("focusout", on_focusout, { capture: true, signal });
  addEventListener("pagehide", bundles.page_hidden, { signal });
  document.addEventListener("visibilitychange", on_visibility_change, { signal });

  wire_mode_reports(page_mode, (mode) => {
    if (!extension_context_alive()) return stop_listening();
    key_flow.reset_sequence();
    bundles.enter_mode(mode);
    void send_to_background({ type: "mode_changed", mode });
  });

  // Coming back from the back-forward cache runs no start-up, and the background's per-tab mode is stale.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void send_to_background({ type: "mode_changed", mode: page_mode.get_mode() });
  });

  page_mode.listen_display(refresh_mode_indicator);

  // Both installs wait for the one tab address read, so a `tree_updated` that comes first cannot decide ignore mode on the frame address alone.
  const tab_address_read = read_tab_address();
  const install_after_tab_address = (keymap_read: Promise<CompiledKeymap | undefined>) =>
    Promise.all([keymap_read, tab_address_read]).then(([keymap, tab_address]) => install_matcher(keymap, tab_address));

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
      page_mode.set_mode(message.mode);
      if (is_editable_element(deepest_focused_element())) page_mode.focus_entered_editable();
    }
    else if (message.type === "tree_updated") void install_after_tab_address(read_keymap());
  });

  void install_after_tab_address(read_keymap().catch(() => undefined)).then(publish_timing);
}

start_content_once(start, window, can_reach_top_document() || document.hasFocus());
