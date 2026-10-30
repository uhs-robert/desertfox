// Content script entry: a capture listener on keydown, the compiled keymap from
// storage, and the modes. Runs in the top frame and in same-origin frames.

import type { BackgroundToContent, CompiledKeymap, ContentToBackground, CountBehavior, Invocation, RunResponse, TreeLeaf } from "../shared/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../shared/index.ts";
import { create_matcher, event_to_token } from "../shared/keys/index.ts";
import { is_editable_element } from "./editable.ts";
import { create_key_flow } from "./key_flow.ts";
import { is_ignored_site } from "./match_pattern.ts";
import { page_mode } from "./page_mode.ts";
import { plan_steps } from "./plan_steps.ts";
import { run_content_invocation } from "./run_content.ts";
import { read_context_source } from "./context.ts";
import { show_toast } from "./toast.ts";
import { blur_focused_element } from "./handlers/page.ts";

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

function run_content_step(invocation: Invocation, count_rule: CountBehavior): void {
  try {
    run_content_invocation(invocation, count_rule);
  } catch (error) {
    show_toast(message_of(error));
  }
}

async function run_leaf(leaf: TreeLeaf, count: number | undefined): Promise<void> {
  for (const segment of plan_steps(leaf.steps, count)) {
    if (segment.runs_in === "content") {
      run_content_step(segment.invocation, segment.count_rule);
      continue;
    }
    const response = await send_to_background({ type: "run", invocations: segment.invocations, mode: page_mode.get_mode() });
    // The background already shows a refusal toast itself, so a returned refusal is not shown again.
    if (!response.ok) return;
  }
}

const key_flow = create_key_flow({
  get_mode: page_mode.get_mode,
  take_pass_next: page_mode.take_pass_next,
  run_leaf: (leaf, count) => void run_leaf(leaf, count),
  leave_insert: () => {
    page_mode.escape();
    blur_focused_element();
  },
});

// Physical keys whose keydown was cancelled: their keypress and keyup are cancelled too.
const cancelled_codes = new Set<string>();

function cancel(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function on_keydown(event: KeyboardEvent): void {
  if (!extension_context_alive()) return stop_listening();
  if (!event.isTrusted || event.isComposing) return;
  const token = event_to_token(event);
  if (token === null) return;
  if (key_flow.handle_token(token) === "cancel") {
    cancelled_codes.add(event.code);
    cancel(event);
  }
}

function on_keypress(event: KeyboardEvent): void {
  if (cancelled_codes.has(event.code)) cancel(event);
}

function on_keyup(event: KeyboardEvent): void {
  if (!cancelled_codes.delete(event.code)) return;
  cancel(event);
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
}

function follow_focus(entered: boolean, event: Event): void {
  if (!is_editable_element(event.composedPath()[0] ?? null)) return;
  if (entered) page_mode.focus_entered_editable();
  else page_mode.focus_left_editable();
}

function install_matcher(keymap: CompiledKeymap | undefined, first_load: boolean): void {
  const usable = keymap?.format_version === COMPILED_KEYMAP_VERSION ? keymap : undefined;
  key_flow.set_matcher(create_matcher(usable ?? { format_version: COMPILED_KEYMAP_VERSION, modes: {}, ignore_sites: [], which_key_delay_ms: 0 }));
  if (!first_load) return;
  if (usable && is_ignored_site(usable.ignore_sites, location.href)) page_mode.set_mode("ignore");
  else if (is_editable_element(document.activeElement)) page_mode.focus_entered_editable();
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
  window.addEventListener("keydown", on_keydown, true);
  window.addEventListener("keypress", on_keypress, true);
  window.addEventListener("keyup", on_keyup, true);
  window.addEventListener("focusin", on_focusin, true);
  window.addEventListener("focusout", on_focusout, true);

  page_mode.listen((mode) => {
    if (!extension_context_alive()) return stop_listening();
    void send_to_background({ type: "mode_changed", mode });
  });

  browser.runtime.onMessage.addListener((raw: unknown) => {
    const message = raw as BackgroundToContent;
    if (message.type === "ping") return Promise.resolve(true);
    if (message.type === "get_selection") return Promise.resolve(read_context_source("selection"));
    if (message.type === "run_in_content") {
      // The router already applied the count, so each invocation runs once.
      for (const invocation of message.invocations) run_content_step(invocation, "ignore");
    }
    else if (message.type === "refusal") show_toast(message.refusal.message);
    else if (message.type === "set_mode") page_mode.set_mode(message.mode);
    else if (message.type === "tree_updated") void read_keymap().then((keymap) => install_matcher(keymap, false));
  });

  void read_keymap()
    .catch(() => undefined)
    .then((keymap) => {
      install_matcher(keymap, true);
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
