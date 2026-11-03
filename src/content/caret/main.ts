// The `caret` bundle: caret mode and visual mode. Loaded on the first `V`, it registers a sink for each mode and
// the handlers of `caret.move` and `visual.act`.

import type { BundleHostApi, ExitDestination } from "../bundle_host.ts";
import { move_once, SCREEN_LINE_UNITS } from "./motion.ts";
import type { Motion } from "./motion.ts";
import { yank_text } from "./copy_text.ts";
import { character_box, screen_line_target } from "./screen_line.ts";
import { apply_selection_colors, clear_selection_colors } from "./selection_colors.ts";
import { scroll_delta } from "./scroll_delta.ts";
import { selected_text, selected_span, swap_ends, with_caret } from "./selection_state.ts";
import type { Cursor } from "./selection_state.ts";
import { build_text_model } from "./text_model.ts";
import type { TextModel } from "./text_model.ts";
import { first_visible_index } from "./start_point.ts";

type CaretWindow = { oasisfox_host: BundleHostApi; oasisfox_caret_ready?: true };
const page = window as unknown as CaretWindow;

type Session = { model: TextModel; cursor: Cursor; mode: "caret" | "visual"; goal_x: number | undefined };
let session: Session | undefined;
// Counts visual starts, so a copy can tell its own visual run from a later one in the same session.
let visual_runs = 0;

function paint(open: Session): void {
  const { from, to } = selected_span(open.cursor);
  const selection = getSelection()!;
  const start = open.model.point_at(from);
  const end = open.model.point_at(to - 1);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  // An empty line has no character to select, so the caret there is not drawn.
  range.setEnd(end.node, open.model.text[to - 1] === "\n" ? end.offset : end.offset + 1);
  selection.removeAllRanges();
  selection.addRange(range);
  scroll_to_caret(open);
}

// Only the caret's own character counts: its paragraph can be taller than the screen. Each scrollable ancestor scrolls first, then the window.
function scroll_to_caret(open: Session): void {
  const caret_node = open.model.point_at(open.cursor.caret).node;
  for (let view = caret_node instanceof Element ? caret_node : caret_node.parentElement; view; view = view.parentElement) {
    const nested = view !== document.documentElement && view !== document.body;
    if (nested && view.scrollHeight <= view.clientHeight && view.scrollWidth <= view.clientWidth) continue;
    const box = character_box(open.model, open.cursor.caret);
    if (!box) return;
    const edges = nested ? view.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const by_x = scroll_delta({ low: box.left, high: box.right }, { low: edges.left, high: edges.right }, box.height);
    const by_y = scroll_delta({ low: box.top, high: box.bottom }, { low: edges.top, high: edges.bottom }, box.height);
    if (by_x || by_y) (nested ? view : window).scrollBy(by_x, by_y);
    if (!nested) return;
  }
}

// Where a new session starts: the caret's place in the page's own selection if it is on screen, else the first visible text.
function start_session(mode: "caret" | "visual", element?: Element): Session | undefined {
  const model = build_text_model(element ?? document.body);
  if (model.text === "") return undefined;
  const caret = first_visible_index(model, getSelection()!, element === undefined);
  return { model, cursor: { anchor: caret, caret }, mode, goal_x: undefined };
}

function end_session(): void {
  session = undefined;
  getSelection()?.removeAllRanges();
  clear_selection_colors();
}

// The span of characters the page's own selection covers, when it lies in the model's text.
function page_span(model: TextModel): { first: number; last: number } | undefined {
  const selection = getSelection()!;
  if (selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const first = model.index_of(range.startContainer, range.startOffset);
  // An end on an empty line is the <br> itself, painted without the +1 a text end has.
  const end_in_text = range.endContainer.nodeType === Node.TEXT_NODE;
  const last = range.collapsed || (end_in_text && range.endOffset === 0) ? first : model.index_of(range.endContainer, end_in_text ? range.endOffset - 1 : range.endOffset);
  return first === undefined || last === undefined ? undefined : { first, last };
}

// Something else moved the page selection since the last paint, such as a find or a click. Caret mode takes the start of it. Visual mode keeps its anchor and takes the end.
function adopt_page_selection(open: Session): void {
  const found = page_span(open.model);
  const { from, to } = selected_span(open.cursor);
  if (!found || (found.first === from && found.last === to - 1)) return;
  open.cursor = with_caret(open.cursor, open.mode === "visual" ? found.last : found.first, open.mode === "visual");
  open.goal_x = undefined;
}

function ensure_session(mode: "caret" | "visual"): Session | undefined {
  const mode_changed = !session || session.mode !== mode;
  if (session) adopt_page_selection(session);
  session ??= start_session(mode);
  if (!session) {
    page.oasisfox_host.set_mode("normal");
    return undefined;
  }
  // Caret mode shows one character, so leaving visual mode drops the anchor.
  if (mode === "caret") session.cursor = { anchor: session.cursor.caret, caret: session.cursor.caret };
  session.mode = mode;
  paint(session);
  if (mode_changed) {
    if (mode === "visual") visual_runs++;
    void apply_selection_colors(mode);
  }
  return session;
}

const sink_for = (mode: "caret" | "visual") => ({
  // Showing the caret on entry is what makes `V` draw it at once.
  enter: () => void ensure_session(mode),
  on_token: (token: string): "handled" | "pass" => {
    if (mode === "caret" || (token !== "<Escape>" && token !== "<C-[>")) return "pass";
    // Escape in visual mode goes back to caret mode, and the keymap never sees it.
    page.oasisfox_host.set_mode("caret");
    return "handled";
  },
  // Between caret and visual the highlight stays. Every other way out clears it.
  exit: (destination: ExitDestination) => {
    if (destination !== "caret" && destination !== "visual") end_session();
  },
});

const handle_move = (args: Record<string, unknown>): void => {
  const open = ensure_session(session?.mode ?? "caret");
  if (!open) return;
  const motion: Motion = { unit: args.unit as Motion["unit"], direction: (args.direction as Motion["direction"] | undefined) ?? "forward", big: args.big === true };
  let caret: number;
  if (SCREEN_LINE_UNITS.includes(motion.unit)) {
    const target = screen_line_target(open.model, getSelection()!, open.cursor.caret, motion, open.goal_x);
    caret = target.index;
    open.goal_x = target.goal_x;
  } else {
    caret = move_once(open.model.text, open.cursor.caret, motion);
    open.goal_x = undefined;
  }
  open.cursor = with_caret(open.cursor, caret, open.mode === "visual");
  paint(open);
};

const handle_act = (args: Record<string, unknown>): void => {
  const open = ensure_session("visual");
  if (!open) return;
  const action = args.action as "yank" | "swap" | "search";
  if (action === "swap") {
    open.cursor = swap_ends(open.cursor);
    paint(open);
    return;
  }
  const text = selected_text(open.model.text, open.cursor);
  if (action === "search") {
    void browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.search", args: { query: text } }], mode: "visual" });
    return page.oasisfox_host.set_mode("caret");
  }
  const run = visual_runs;
  // Visual mode stays until the copy is done, so a refused copy leaves the selection to retry.
  void yank_text(navigator.clipboard, text, {
    is_same_session: () => visual_runs === run && session === open && open.mode === "visual",
    toast: page.oasisfox_host.show_toast,
    leave_visual: () => page.oasisfox_host.set_mode("caret"),
  });
};

// A bundle may run twice, and a second run would hold fresh state next to the first.
if (!page.oasisfox_caret_ready) {
  page.oasisfox_caret_ready = true;
  page.oasisfox_host.register_sink("caret", sink_for("caret"));
  page.oasisfox_host.register_sink("visual", sink_for("visual"));
  page.oasisfox_host.register_handler("caret.move", handle_move);
  page.oasisfox_host.register_handler("visual.act", handle_act);
}
