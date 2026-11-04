// Content script entry: a capture listener on keydown, the compiled keymap from
// storage, and the modes. Runs in the top frame and in same-origin frames.

import type { BackgroundToContent, CompiledKeymap, ContentToBackground, Mode, ModeIndicator, RunResponse, TreeLeaf } from "../shared/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION, DEFAULT_SETTINGS, current_keymap } from "../shared/index.ts";
import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import type { BundleHostApi } from "./bundle_host.ts";
import { bundles } from "./bundles.ts";
import { is_editable_element } from "./editable.ts";
import { create_cancelled_keys } from "./cancelled_keys.ts";
import { create_key_flow } from "./key_flow.ts";
import { create_which_key_timer } from "./which_key_timer.ts";
import { mode_label } from "./mode_label.ts";
import type { BadgeColors } from "./mode_indicator.ts";
import { show_mode_label, show_toast } from "./ui_proxy.ts";
import { wire_mode_reports } from "./mode_report.ts";
import { page_mode } from "./page_mode.ts";
import { plan_steps } from "./plan_steps.ts";
import { run_content_invocation, run_in_order } from "./run_content.ts";
import { read_context_source } from "./context.ts";
import { focus_page_content } from "./handlers/focus.ts";
import { blur_focused_element } from "./handlers/page.ts";

// Until the tree is read the setting is unknown, and the default applies.
let mode_indicator: ModeIndicator = DEFAULT_SETTINGS.mode_indicator;
// Absent until the tree is read, and the badge keeps its plain colors.
let mode_colors: Partial<Record<Mode, BadgeColors>> | undefined;

function refresh_mode_indicator(): void {
  const mode = page_mode.get_mode();
  const pass_next_armed = page_mode.is_pass_next_armed();
  show_mode_label(mode_label(mode, pass_next_armed, mode_indicator), pass_next_armed ? undefined : mode_colors?.[mode]);
}

const script_started_ms = performance.now();

// A cross-origin frame cannot reach the top document. The manifest injects into all frames.
function can_reach_top_document(): boolean {
  try {
    return Boolean(window.top?.document);
  } catch {
    return false;
  }
}

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function send_to_background(message: ContentToBackground): Promise<RunResponse> {
  try {
    return (await browser.runtime.sendMessage(message)) as RunResponse;
  } catch (error) {
    return { ok: false, refusal: { id: "oasisfox", message: `OasisFox background did not answer: ${message_of(error)}` } };
  }
}

async function run_leaf(leaf: TreeLeaf, count: number | undefined): Promise<void> {
  for (const segment of plan_steps(leaf.steps, count)) {
    const outcome =
      segment.runs_in === "content"
        ? await run_content_invocation(segment.invocation, segment.count_rule)
        : await send_to_background({ type: "run", invocations: segment.invocations, mode: page_mode.get_mode() });
    // The background already shows a refusal toast itself, so a returned refusal is not shown again.
    if ("message" in outcome) show_toast(outcome.message);
    // A failed or cancelled step stops the rest of the leaf.
    if (!outcome.ok || outcome.cancelled) return;
  }
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
  run_leaf: (leaf, count) => void run_leaf(leaf, count),
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
  const decision = key_flow.handle_token(token);
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

function stop_listening(): void {
  window.removeEventListener("keydown", on_keydown, true);
  window.removeEventListener("keypress", on_keypress, true);
  window.removeEventListener("keyup", on_keyup, true);
  window.removeEventListener("focusin", on_focusin, true);
  window.removeEventListener("focusout", on_focusout, true);
  removeEventListener("pagehide", bundles.page_hidden);
  document.removeEventListener("visibilitychange", on_visibility_change);
}

function on_visibility_change(): void {
  if (document.hidden) bundles.page_hidden();
}

function follow_focus(entered: boolean, event: Event): void {
  if (!is_editable_element(event.composedPath()[0] ?? null)) return;
  if (entered) page_mode.focus_entered_editable();
  else page_mode.focus_left_editable();
}

let matcher_installed = false;
// The first usable tree decides ignore mode, whether it came at load or later through `tree_updated` (after an upgrade).
let ignore_checked = false;

// A stored regex that does not compile ignores nothing, so keys keep working.
function is_ignored_site(source: string | undefined): boolean {
  try {
    return source !== undefined && new RegExp(source).test(location.href);
  } catch {
    return false;
  }
}

function install_matcher(keymap: CompiledKeymap | undefined): void {
  const usable = current_keymap(keymap);
  // A tree stored before the setting existed has no value, which means the default.
  mode_indicator = usable?.mode_indicator ?? DEFAULT_SETTINGS.mode_indicator;
  mode_colors = usable?.mode_colors;
  which_key_delay_ms = usable?.which_key_delay_ms;
  // The mode comes first, so keys held during the load replay in the right mode.
  const first_install = !matcher_installed;
  matcher_installed = true;
  const first_usable = usable !== undefined && !ignore_checked;
  if (usable) ignore_checked = true;
  if (first_usable && is_ignored_site(usable.ignore_regex)) page_mode.set_mode("ignore");
  else if (first_install && is_editable_element(document.activeElement)) page_mode.focus_entered_editable();
  refresh_mode_indicator();
  key_flow.set_matcher(create_matcher(usable ?? { format_version: COMPILED_KEYMAP_VERSION, modes: {}, mode_indicator: DEFAULT_SETTINGS.mode_indicator, which_key_delay_ms: 0 }), usable?.modes.browser);
}

async function read_keymap(): Promise<CompiledKeymap | undefined> {
  const stored = await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY);
  return stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
}

// The key test reads these two attributes. Times are milliseconds.
function publish_timing(): void {
  const root = document.documentElement;
  root?.setAttribute("data-oasisfox-tree-read-ms", (performance.now() - script_started_ms).toFixed(2));
  root?.setAttribute("data-oasisfox-tree-ready-at-ms", performance.now().toFixed(2));
}

function start(): void {
  (window as unknown as { oasisfox_host: BundleHostApi }).oasisfox_host = bundles.api;
  window.addEventListener("keydown", on_keydown, true);
  window.addEventListener("keypress", on_keypress, true);
  window.addEventListener("keyup", on_keyup, true);
  window.addEventListener("focusin", on_focusin, true);
  window.addEventListener("focusout", on_focusout, true);
  addEventListener("pagehide", bundles.page_hidden);
  document.addEventListener("visibilitychange", on_visibility_change);

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
    else if (message.type === "set_mode") page_mode.set_mode(message.mode);
    else if (message.type === "tree_updated") void read_keymap().then((keymap) => install_matcher(keymap));
  });

  void read_keymap()
    .catch(() => undefined)
    .then((keymap) => {
      install_matcher(keymap);
      publish_timing();
    });
}

// A second injection into the same page must not add a second set of listeners.
const LOADED_FLAG = "oasisfox_content_loaded";
const loaded_flags = window as unknown as Record<string, boolean>;
if (can_reach_top_document() && !loaded_flags[LOADED_FLAG]) {
  loaded_flags[LOADED_FLAG] = true;
  start();
}
