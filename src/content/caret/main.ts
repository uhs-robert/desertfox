// The `caret` bundle: caret mode and visual mode, and page search. Loaded on the first entry into caret or visual mode or the first search, it registers a sink for each mode and
// the handlers of `caret.move`, `visual.act` and the `find.*` commands.

import type { Outcome, RunResponse } from "../../shared/messages.ts";
import type { BundleHostApi, ExitDestination } from "../bundle_host.ts";
import { find_char_hit, find_char_matches, move_once, SCREEN_LINE_UNITS } from "./motion.ts";
import type { CharFind, Motion } from "./motion.ts";
import { deepest_focused_element } from "../editable.ts";
import { yank_text } from "./copy_text.ts";
import { create_find_mode } from "./find_mode.ts";
import { CHAR_FIND_NAMES, create_painter } from "./find_paint.ts";
import type { FindColors } from "./find_paint.ts";
import { create_find, read_find_colors } from "./find_session.ts";
import { scroll_to_index, screen_line_target } from "./screen_line.ts";
import { apply_selection_colors, clear_selection_colors } from "./selection_colors.ts";

import { retarget, selected_text, selected_span, swap_ends, with_caret } from "./selection_state.ts";
import type { Cursor } from "./selection_state.ts";
import { build_text_model, documents_of, frame_document, trees_alive } from "./text_model.ts";
import type { DomPoint, TextModel } from "./text_model.ts";
import { page_selection_cursor, selection_span } from "./page_selection.ts";
import { first_visible_index, visible_index_range } from "./start_point.ts";
import { indexes_in_range, pad_range } from "./visible_range.ts";

// `oasisfox_caret_target` is the element a hint picked. The hints bundle sets it just before it enters the mode.
type CaretWindow = { oasisfox_host: BundleHostApi; oasisfox_caret_ready?: true; oasisfox_caret_target?: Element };
const page = window as unknown as CaretWindow;
const find = create_find(page.oasisfox_host);

// `painted` holds the ends of each selection as the last paint left it, so a later change by the page shows.
type Session = { model: TextModel; cursor: Cursor; mode: "caret" | "visual"; goal_x: number | undefined; painted: SelectionEnds[] };
type SelectionEnds = { selection: Selection; ends: unknown[] };
let session: Session | undefined;
// Counts visual starts, so a copy can tell its own visual run from a later one in the same session.
let visual_runs = 0;
// The visual session a `/` or `?` started from. The command line takes the mode while it is open, and the session waits for the end of the search.
let searching_from: Session | undefined;

// `f` arms this and the next printable key is its target. A count arrives as repeated calls of the handler, which add to `count`.
let pending_find: { direction: CharFind["direction"]; till: boolean; count: number } | undefined;
// The last find for `;` and `,`. Per page, and not a register.
let last_find: CharFind | undefined;

// The matches of the last find's character that stay lit while the find is live. Exact case, so the keymap's case means what it says.
const char_painter = create_painter(CHAR_FIND_NAMES);
let char_colors: FindColors | undefined;
// Where the match the caret stands at or next to sits in the text. A new model has other positions, so it falls back to the caret.
let current_match: { model: TextModel; at: number } | undefined;
let char_matches: { model: TextModel; char: string; from: number[]; to: number[] } | undefined;

function show_char_matches(): void {
  const open = session;
  // The session is gone, or a frame or shadow host left the page under the find.
  if (!open || !last_find || !trees_alive(open.model)) return find_mode.end();
  if (!char_colors) return;
  if (char_matches?.model !== open.model || char_matches.char !== last_find.char) {
    const from = find_char_matches(open.model.text, last_find.char);
    char_matches = { model: open.model, char: last_find.char, from, to: from.map((at) => at + last_find!.char.length) };
  }
  const { from } = char_matches;
  const marked = current_match?.model === open.model ? current_match.at : open.cursor.caret;
  const current = from.indexOf(marked);
  const { first, last } = visible_index_range(open.model);
  const padded = pad_range(first, last, open.model.text.length);
  char_painter.paint(open.model, char_matches, current, char_colors, indexes_in_range(from, padded.first, padded.last, Math.max(current, 0)));
}

// One scroll or resize burst repaints once, in the next frame.
function watch_view(on_change: () => void): () => void {
  let frame = 0;
  const on_event = () => {
    if (frame === 0) frame = requestAnimationFrame(() => ((frame = 0), on_change()));
  };
  // Capture, because a scroll does not bubble out of a nested scroller.
  window.addEventListener("scroll", on_event, { capture: true, passive: true });
  window.addEventListener("resize", on_event, { passive: true });
  return () => {
    window.removeEventListener("scroll", on_event, { capture: true });
    window.removeEventListener("resize", on_event);
    cancelAnimationFrame(frame);
    frame = 0;
  };
}

const find_mode = create_find_mode({ show: show_char_matches, hide: () => char_painter.clear(), watch_view, defer: (task) => queueMicrotask(task) });

const selections_of = (model: TextModel): Selection[] => documents_of(model).flatMap((owner) => owner.getSelection() ?? []);

function ends_of(selection: Selection): unknown[] {
  if (selection.rangeCount === 0) return [];
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  // The anchor and focus are in it because a span drawn again the other way round has the same range ends.
  return [first.startContainer, first.startOffset, last.endContainer, last.endOffset, selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset];
}

// A Range stays in one tree, so a span across a shadow root or a frame takes one range per tree. Firefox keeps several ranges in one selection.
function paint(open: Session): void {
  const { from, to } = selected_span(open.cursor);
  const selections = selections_of(open.model);
  for (const selection of selections) selection.removeAllRanges();
  const runs = open.model.tree_runs(from, to);
  runs.forEach((run, at) => {
    // The line end before the next tree has no character to select.
    let run_to = run.to;
    while (at < runs.length - 1 && run_to > run.from + 1 && open.model.text[run_to - 1] === "\n") run_to--;
    const start = open.model.point_at(run.from);
    const end = open.model.point_at(run_to - 1);
    const owner = start.node.ownerDocument!;
    const range = owner.createRange();
    range.setStart(start.node, start.offset);
    // An empty line has no character to select, so the caret there is not drawn.
    range.setEnd(end.node, open.model.text[run_to - 1] === "\n" ? end.offset : end.offset + 1);
    owner.getSelection()?.addRange(range);
  });
  open.painted = selections.map((selection) => ({ selection, ends: ends_of(selection) }));
  scroll_to_index(open.model, open.cursor.caret);
}

// Where a new session starts: the text of the picked element or the next text after it, else the match a search stands on while no later selection took the place, else the page's own drag (whole in visual mode, its release end in caret mode), else the caret's place in the page's own selection if it is on screen, else the first visible text.
// A string is the reason no session could start.
function start_session(mode: "caret" | "visual"): Session | string {
  const target = page.oasisfox_caret_target;
  delete page.oasisfox_caret_target;
  const is_other_site_frame = target !== undefined && (target.localName === "iframe" || target.localName === "frame") && !frame_document(target);
  if (is_other_site_frame) {
    return "Caret cannot reach a frame from another site";
  }
  // The model covers the whole page, so motion is not trapped in the element.
  const model = build_text_model(document.body, target);
  if (model.text === "") return "No text here";
  const dragged = target === undefined ? selections_of(model).flatMap((selection) => page_selection_cursor(model, selection) ?? [])[0] : undefined;
  // A search position is valid only while no selection came after it, so it is newer than any drag and wins.
  const searched = target === undefined ? find.position(model) : undefined;
  if (mode === "visual" && dragged && searched === undefined) return { model, cursor: dragged, mode, goal_x: undefined, painted: [] };
  const caret = target === undefined ? (searched ?? dragged?.caret ?? first_visible_index(model)) : model.start_index;
  if (caret === undefined) return "No text here";
  return { model, cursor: { anchor: caret, caret }, mode, goal_x: undefined, painted: [] };
}

// A frame or a shadow host left the page while the session was open. The caret keeps its character if that is still on the page.
function rebuild_if_stale(open: Session): Session | undefined {
  if (trees_alive(open.model)) return open;
  for (const selection of selections_of(open.model)) selection.removeAllRanges();
  const model = build_text_model(document.body);
  if (model.text === "") return undefined;
  // A node of a removed frame throws on any read.
  const carry = (index: number) => {
    const { node, offset } = open.model.point_at(index);
    try {
      return model.index_of(node, offset);
    } catch {
      return undefined;
    }
  };
  const caret = carry(open.cursor.caret) ?? first_visible_index(model);
  const anchor = open.mode === "visual" ? (carry(open.cursor.anchor) ?? caret) : caret;
  return retarget(open, model, { anchor, caret });
}

function selection_is_in_focused_editable(selection: Selection): boolean {
  const focused = deepest_focused_element();
  return focused instanceof HTMLElement && focused.isContentEditable && focused.contains(selection.anchorNode);
}

function end_session(): void {
  // A focused contenteditable field keeps its own caret in the document selection.
  for (const selection of session ? selections_of(session.model) : []) if (!selection_is_in_focused_editable(selection)) selection.removeAllRanges();
  const page_selection = getSelection();
  if (page_selection && !selection_is_in_focused_editable(page_selection)) page_selection.removeAllRanges();
  session = undefined;
  find_mode.end();
  clear_selection_colors();
}

// Something else moved a page selection since the last paint, such as a find, a drag or a click. A drag is taken whole in either mode, because the next key may switch the mode. A click keeps the anchor in visual mode and takes the click.
function adopt_page_selection(open: Session): void {
  for (const selection of selections_of(open.model)) {
    const ends = ends_of(selection);
    const painted = open.painted.find((record) => record.selection === selection)?.ends ?? [];
    if (ends.length === painted.length && ends.every((end, at) => end === painted[at])) continue;
    const found = selection_span(open.model, selection);
    if (!found) continue;
    open.cursor = page_selection_cursor(open.model, selection) ?? with_caret(open.cursor, found.first, open.mode === "visual");
    open.goal_x = undefined;
    return;
  }
}

// A string is the failure message. The mode went back to normal then.
function ensure_session(mode: "caret" | "visual"): Session | string {
  const mode_changed = !session || session.mode !== mode;
  const model_before = session?.model;
  if (session) session = rebuild_if_stale(session);
  if (session) adopt_page_selection(session);
  if (!session) {
    const started = start_session(mode);
    if (typeof started === "string") {
      page.oasisfox_host.set_mode("normal");
      return started;
    }
    session = started;
  }
  // Caret mode shows one character, so leaving visual mode drops the anchor.
  if (mode === "caret") session.cursor = { anchor: session.cursor.caret, caret: session.cursor.caret };
  session.mode = mode;
  paint(session);
  if (mode_changed && mode === "visual") visual_runs++;
  // A rebuild brings new trees, which have no selection style yet.
  if (mode_changed || session.model !== model_before) void apply_selection_colors(mode, session.model.trees);
  return session;
}

// A printable key is the target. Escape cancels and is spent. A chord or named key cancels and then runs as usual.
function take_find_target(token: string): "handled" | "pass" {
  const find = pending_find!;
  pending_find = undefined;
  if (token === "<Escape>" || token === "<C-[>") return "handled";
  const char = token === "<Space>" ? " " : token;
  if ([...char].length !== 1) return "pass";
  const open = ensure_session(session?.mode ?? "caret");
  if (typeof open === "string") return "handled";
  last_find = { char, direction: find.direction, till: find.till };
  move_to_find(open, last_find, find.count, false);
  begin_char_matches(find.till);
  return "handled";
}

// The caret goes to the count-th match, and the match is the current one for the highlights. With fewer matches the caret stays.
function move_to_find(open: Session, find: CharFind, count: number, again: boolean): void {
  const hit = find_char_hit(open.model.text, open.cursor.caret, find, count, again);
  open.cursor = with_caret(open.cursor, hit?.caret ?? open.cursor.caret, open.mode === "visual");
  if (hit) current_match = { model: open.model, at: hit.match };
  open.goal_x = undefined;
  paint(open);
}

function begin_char_matches(till: boolean): void {
  const had_colors = char_colors !== undefined;
  find_mode.start(till);
  if (had_colors) return;
  void read_find_colors().then((colors) => {
    char_colors = colors;
    find_mode.refresh();
  });
}

const sink_for = (mode: "caret" | "visual") => ({
  // Showing the caret on entry is what makes entering the mode draw it at once.
  enter: () => {
    pending_find = undefined;
    find_mode.end();
    const started = ensure_session(mode);
    if (typeof started === "string") page.oasisfox_host.show_toast(started);
  },
  on_token: (token: string): "handled" | "pass" => {
    if (pending_find) return take_find_target(token);
    if (find_mode.is_live()) {
      // Escape only ends the find, in visual mode too.
      return find_mode.on_token(token);
    }
    if (mode === "caret" || (token !== "<Escape>" && token !== "<C-[>")) return "pass";
    // Escape in visual mode goes back to caret mode, and the keymap never sees it.
    page.oasisfox_host.set_mode("caret");
    return "handled";
  },
  // Between caret and visual the highlight stays. Every other way out clears it.
  exit: (destination: ExitDestination) => {
    const is_search_line = destination === "cmdline" && searching_from !== undefined && searching_from === session;
    pending_find = undefined;
    find_mode.end();
    if (destination !== "caret" && destination !== "visual" && !is_search_line) end_session();
  },
});

const handle_move = (args: Record<string, unknown>): Outcome | undefined => {
  // From the command line the mode is normal, so no sink would take the target key.
  if (args.unit === "char_find" && !["caret", "visual"].includes(page.oasisfox_host.get_mode())) return;
  const open = ensure_session(session?.mode ?? "caret");
  if (typeof open === "string") return { ok: false, message: open };
  if (args.unit === "char_find") {
    const direction = (args.direction as CharFind["direction"] | undefined) ?? "forward";
    const till = args.till === true;
    find_mode.note_find_key();
    if (find_mode.is_live() && last_find && find_mode.is_till() === till) {
      // The same key family repeats in the key's own direction, which then is the direction of `;`.
      last_find = { ...last_find, direction };
      move_to_find(open, last_find, 1, till);
      find_mode.refresh();
      return;
    }
    // The other family ends this find and starts its own.
    find_mode.end();
    if (pending_find) pending_find.count++;
    else pending_find = { direction, till, count: 1 };
    return;
  }
  if (args.unit === "find_repeat") {
    find_mode.note_find_key();
    if (!last_find) return;
    const reversed = args.direction === "back";
    const direction = reversed === (last_find.direction === "back") ? "forward" : "back";
    move_to_find(open, { ...last_find, direction }, 1, true);
    find_mode.refresh();
    return;
  }
  const motion: Motion = { unit: args.unit as Motion["unit"], direction: (args.direction as Motion["direction"] | undefined) ?? "forward", big: args.big === true };
  let caret: number;
  if (SCREEN_LINE_UNITS.includes(motion.unit)) {
    const target = screen_line_target(open.model, open.cursor.caret, motion, open.goal_x);
    caret = target.index;
    open.goal_x = target.goal_x;
  } else {
    caret = move_once(open.model.text, open.cursor.caret, motion);
    open.goal_x = undefined;
  }
  open.cursor = with_caret(open.cursor, caret, open.mode === "visual");
  paint(open);
};

const handle_act = (args: Record<string, unknown>): Outcome | Promise<Outcome> | undefined => {
  const open = ensure_session("visual");
  if (typeof open === "string") return { ok: false, message: open };
  const action = args.action as "yank" | "swap" | "search";
  if (action === "swap") {
    open.cursor = swap_ends(open.cursor);
    paint(open);
    return;
  }
  const text = selected_text(open.model.text, open.cursor);
  if (action === "search") {
    // The router shows a refusal of its own, so the answer only decides whether a sequence goes on.
    const searched = browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.search", args: { query: text } }], mode: "visual" }) as Promise<RunResponse>;
    page.oasisfox_host.set_mode("caret");
    return searched.then((answer): Outcome => (answer.ok ? answer : { ok: true, cancelled: true }), (): Outcome => ({ ok: false, message: "OasisFox background did not answer" }));
  }
  const run = visual_runs;
  // Visual mode stays until the copy is done, so a refused copy leaves the selection to retry.
  return yank_text(navigator.clipboard, text, {
    is_same_session: () => visual_runs === run && session === open && open.mode === "visual",
    toast: page.oasisfox_host.show_toast,
    leave_visual: () => page.oasisfox_host.set_mode("caret"),
  });
};

const WORD_CHARACTER = /^[\p{L}\p{N}_]$/u;
// Part of a word, read by code point: both halves of a surrogate pair give the same answer.
function in_word(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  const start = unit >= 0xdc00 && unit <= 0xdfff && index > 0 ? index - 1 : index;
  return index >= 0 && index < text.length && WORD_CHARACTER.test(text.slice(start, start + (text.codePointAt(start)! > 0xffff ? 2 : 1)));
}
const escape_regex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What `*` and `#` search for and where it starts. A visual selection is searched as text. Otherwise it is the word under the caret, whole.
// With no session the start of the visible text stands in for the caret.
function word_target(): { pattern: string; from: DomPoint } | string {
  const model = session?.model ?? build_text_model(document.body);
  if (model.text === "") return "No text here";
  const at = session ? undefined : (find.position(model) ?? first_visible_index(model));
  const cursor = session?.cursor ?? { anchor: at!, caret: at! };
  if (session?.mode === "visual") {
    const { from, to } = selected_span(cursor);
    return { pattern: `(?-i:${escape_regex(model.text.slice(from, to))})`, from: model.point_at(from) };
  }
  const on_word = (index: number) => in_word(model.text, index);
  if (!on_word(cursor.caret)) return "No word under the caret";
  let first = cursor.caret;
  let end = cursor.caret + 1;
  while (on_word(first - 1)) first--;
  while (on_word(end)) end++;
  // Lookarounds and not `\b`, which treats a letter outside ASCII as a boundary.
  const pattern = `(?<![\\p{L}\\p{N}_])${escape_regex(model.text.slice(first, end))}(?![\\p{L}\\p{N}_])`;
  return { pattern, from: model.point_at(first) };
}

// A visual session searches from its caret, so it first catches up with the page. Other modes have nothing to catch up.
const visual_session_now = () => (session?.mode === "visual" ? ensure_session("visual") : undefined);

// `n` and `N`: step to the match, and a visual session takes its caret end there.
async function find_step(reverse: boolean): Promise<Outcome> {
  const started = visual_session_now();
  if (typeof started === "string") return { ok: false, message: started };
  const outcome = await find.step(reverse, started && started.model.point_at(started.cursor.caret));
  const open = session;
  const landed = open?.mode === "visual" && outcome.ok && !("cancelled" in outcome && outcome.cancelled) ? find.position(open.model) : undefined;
  if (open && landed !== undefined) {
    open.cursor = with_caret(open.cursor, landed, true);
    open.goal_x = undefined;
    paint(open);
  }
  return outcome;
}

// `*` and `#`: search for the word or selection at once, and let an open session follow the match.
async function find_word(direction: "forward" | "backward"): Promise<Outcome> {
  const started = visual_session_now();
  if (typeof started === "string") return { ok: false, message: started };
  const target = word_target();
  if (typeof target === "string") return { ok: false, message: target };
  const outcome = await find.jump(target.pattern, direction, target.from);
  const open = session;
  const landed = open && outcome.ok && !("cancelled" in outcome && outcome.cancelled) ? find.position(open.model) : undefined;
  if (open && landed !== undefined) {
    open.cursor = with_caret(open.cursor, landed, open.mode === "visual");
    open.goal_x = undefined;
    paint(open);
  }
  return outcome;
}

// The search line closed on a visual session. Enter takes the caret end to the match, and either way the mode goes back to visual.
async function end_visual_search(from: Session, keep: boolean): Promise<void> {
  if (session !== from) return;
  const landed = keep ? find.position(from.model) : undefined;
  if (landed !== undefined) {
    from.cursor = with_caret(from.cursor, landed, true);
    from.goal_x = undefined;
  }
  page.oasisfox_host.set_mode("visual");
}

// A bundle may run twice, and a second run would hold fresh state next to the first.
if (!page.oasisfox_caret_ready) {
  page.oasisfox_caret_ready = true;
  page.oasisfox_host.register_sink("caret", sink_for("caret"));
  page.oasisfox_host.register_sink("visual", sink_for("visual"));
  page.oasisfox_host.register_handler("caret.move", handle_move);
  page.oasisfox_host.register_handler("visual.act", handle_act);
  page.oasisfox_host.register_handler("find.open", (args) => {
    const direction = args.direction === "backward" ? "backward" : "forward";
    if (args.source === "word") return find_word(direction);
    const started = visual_session_now();
    if (typeof started === "string") return { ok: false, message: started };
    searching_from = started;
    find.begin(direction, started?.model.point_at(started.cursor.caret));
    return page.oasisfox_host.run_command("cmdline.open", "cmdline", { search: direction });
  });
  page.oasisfox_host.register_handler("find.next", () => find_step(false));
  page.oasisfox_host.register_handler("find.prev", () => find_step(true));
  // Called by the command line while it is open, and not by any key.
  page.oasisfox_host.register_handler("find.live", (args) => find.update(args.text as string, args.report as (status: string) => void));
  page.oasisfox_host.register_handler("find.end", async (args) => {
    const keep = args.keep === true;
    await find.end(keep);
    const from = searching_from;
    searching_from = undefined;
    if (from) await end_visual_search(from, keep);
  });
  page.oasisfox_host.register_handler("find.clear", () => find.clear());
}
