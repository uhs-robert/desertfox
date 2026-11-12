// The `caret` bundle: caret mode, both visual modes, and page search. Loaded on the first entry into one of these modes or the first search, it registers a sink for each mode and
// the handlers of `caret.move`, `visual.act`, `visual.object`, `visual.open` and the `find.*` commands.

import type { Outcome, RunResponse } from "../../shared/messages.ts";
import type { BundleHostApi, ExitDestination } from "../bundle_host.ts";
import { find_char_hit, find_char_matches, is_screen_unit, move_once } from "./motion.ts";
import type { CharFind, Direction, MotionUnit, ScreenMotion } from "./motion.ts";
import { deepest_focused_element } from "../editable.ts";
import { yank_text } from "./copy_text.ts";
import { create_find_mode, is_escape } from "./find_mode.ts";
import { CHAR_FIND_NAMES, create_painter } from "./find_paint.ts";
import type { FindColors } from "./find_paint.ts";
import type { FindView } from "./find_mode.ts";
import { create_find, read_find_colors } from "./find_session.ts";
import { select_object } from "./text_object.ts";
import { scroll_to_index, screen_line_target } from "./screen_line.ts";
import { apply_selection_colors, clear_selection_colors, keep_selection_colors } from "./selection_colors.ts";

import { is_visual, line_span, retarget, selected_text, selected_span, swap_ends, with_caret } from "./selection_state.ts";
import type { CaretMode, Cursor, Span } from "./selection_state.ts";
import { build_text_model, documents_of, frame_document, trees_alive } from "./text_model.ts";
import type { DomPoint, TextModel } from "./text_model.ts";
import { page_selection_cursor, selection_span } from "./page_selection.ts";
import { first_visible_index, visible_index_range } from "./start_point.ts";
import { indexes_in_range, pad_range } from "./visible_range.ts";

// `desertfox_caret_target` is the element a hint picked. The hints bundle sets it just before it enters the mode.
type CaretWindow = { desertfox_host: BundleHostApi; desertfox_caret_ready?: true; desertfox_caret_target?: Element };
const page = window as unknown as CaretWindow;
const find = create_find(page.desertfox_host);

// `painted_` holds the ends of each selection as the last paint left it, so a later change by the page shows. `painted_span_` is the text that paint drew, which a linewise session cannot measure again without moving the page selection.
type Session = { model_: TextModel; cursor: Cursor; mode: CaretMode; goal_x_: number | undefined; painted_: SelectionEnds[]; painted_span_: Span };
type SelectionEnds = { selection: Selection; ends: unknown[] };
let session: Session | undefined;
// Counts visual starts, so a copy can tell its own visual run from a later one in the same session.
let visual_runs = 0;
// The caret or visual session a `/` or `?` started from. The command line takes the mode while it is open, and the session waits for the end of the search.
let searching_from: Session | undefined;

// The last find for `;` and `,`. Per page, and not a register.
let last_find: CharFind | undefined;

// The matches of the last find's character that stay lit while the find is live. Exact case, so the keymap's case means what it says.
const char_painter = create_painter(CHAR_FIND_NAMES);
let char_matches: { model_: TextModel; char: string; from: number[] } | undefined;

// `view.current` is where the match the caret stands at or next to sits. A find that found nothing has none, and a new model has other positions, so both fall back to the caret.
function show_char_matches(view: FindView<FindColors>): void {
  const open = session;
  // The session is gone, or a frame or shadow host left the page under the find.
  if (!open || !last_find || !trees_alive(open.model_)) return find_mode.end();
  if (!view.colors) return;
  if (char_matches?.model_ !== open.model_ || char_matches.char !== last_find.char) char_matches = { model_: open.model_, char: last_find.char, from: find_char_matches(open.model_.text, last_find.char) };
  const { from } = char_matches;
  const marked = view.current !== undefined && view.current_owner_ === open.model_ ? view.current : open.cursor.caret;
  const current = from.indexOf(marked);
  const { first, last } = visible_index_range(open.model_);
  const padded = pad_range(first, last, open.model_.text.length);
  char_painter.paint(open.model_, { from, width: last_find.char.length }, current, view.colors, indexes_in_range(from, padded.first, padded.last, Math.max(current, 0)));
}

// One scroll or resize burst repaints once, in the next frame.
function watch_view_(on_change: () => void): () => void {
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

const find_mode = create_find_mode({ read_colors_: read_find_colors, show: show_char_matches, hide: () => char_painter.clear(), watch_view_ });

const selections_of = (model: TextModel): Selection[] => documents_of(model).flatMap((owner) => owner.getSelection() ?? []);

function ends_of(selection: Selection): unknown[] {
  if (selection.rangeCount === 0) return [];
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  // The anchor and focus are in it because a span drawn again the other way round has the same range ends.
  return [first.startContainer, first.startOffset, last.endContainer, last.endOffset, selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset];
}

const SCREEN_LINE_START: ScreenMotion = { unit: "line_start", direction: "back" };
const SCREEN_LINE_END: ScreenMotion = { unit: "line_end", direction: "forward" };

// Measured with `Selection.modify`, which moves the page selection, so only paint calls it.
function span_of(open: Session): Span {
  if (open.mode !== "visual_line") return selected_span(open.cursor);
  return line_span(open.cursor, {
    start_of_: (index) => screen_line_target(open.model_, index, SCREEN_LINE_START).index,
    end_of: (index) => screen_line_target(open.model_, index, SCREEN_LINE_END).index,
  });
}

// A Range stays in one tree, so a span across a shadow root or a frame takes one range per tree. Firefox keeps several ranges in one selection.
function paint(open: Session): void {
  const { from, to } = (open.painted_span_ = span_of(open));
  const selections = selections_of(open.model_);
  for (const selection of selections) selection.removeAllRanges();
  const runs = open.model_.tree_runs_(from, to);
  runs.forEach((run, at) => {
    // The line end before the next tree has no character to select.
    let run_to = run.to;
    while (at < runs.length - 1 && run_to > run.from + 1 && open.model_.text[run_to - 1] === "\n") run_to--;
    const start = open.model_.point_at_(run.from);
    const end = open.model_.point_at_(run_to - 1);
    const owner = start.node.ownerDocument!;
    const range = owner.createRange();
    range.setStart(start.node, start.offset);
    // An empty line has no character to select, so the caret there is not drawn.
    range.setEnd(end.node, open.model_.text[run_to - 1] === "\n" ? end.offset : end.offset + 1);
    owner.getSelection()?.addRange(range);
  });
  open.painted_ = selections.map((selection) => ({ selection, ends: ends_of(selection) }));
  keep_selection_colors(open.model_.trees);
  scroll_to_index(open.model_, open.cursor.caret);
}

// Where a new session starts: the text of the picked element or the next text after it, else the match a search stands on while no later selection took the place, else the page's own drag (whole in visual mode, its release end in caret mode), else the caret's place in the page's own selection if it is on screen, else the first visible text.
// A string is the reason no session could start.
function start_session(mode: CaretMode): Session | string {
  const target = page.desertfox_caret_target;
  delete page.desertfox_caret_target;
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
  if (is_visual(mode) && dragged && searched === undefined) return { model_: model, cursor: dragged, mode, goal_x_: undefined, painted_: [], painted_span_: selected_span(dragged) };
  const caret = target === undefined ? (searched ?? dragged?.caret ?? first_visible_index(model)) : model.start_index_;
  if (caret === undefined) return "No text here";
  const cursor = { anchor: caret, caret };
  return { model_: model, cursor, mode, goal_x_: undefined, painted_: [], painted_span_: selected_span(cursor) };
}

// A frame or a shadow host left the page while the session was open.
function rebuild_if_stale(open: Session): Session | undefined {
  if (trees_alive(open.model_)) return open;
  for (const selection of selections_of(open.model_)) selection.removeAllRanges();
  return rebuild_model(open);
}

// Reads the page text again. The caret keeps its character if that is still on the page.
function rebuild_model(open: Session): Session | undefined {
  const model = build_text_model(document.body);
  if (model.text === "") return undefined;
  // A node of a removed frame throws on any read.
  const carry = (index: number) => {
    const { node, offset } = open.model_.point_at_(index);
    try {
      return model.index_of_(node, offset);
    } catch {
      return undefined;
    }
  };
  const caret = carry(open.cursor.caret) ?? first_visible_index(model);
  const anchor = is_visual(open.mode) ? (carry(open.cursor.anchor) ?? caret) : caret;
  return retarget(open, model, { anchor, caret });
}

function selection_is_in_focused_editable(selection: Selection): boolean {
  const focused = deepest_focused_element();
  return focused instanceof HTMLElement && focused.isContentEditable && focused.contains(selection.anchorNode);
}

function end_session(): void {
  // A focused contenteditable field keeps its own caret in the document selection.
  for (const selection of session ? selections_of(session.model_) : []) if (!selection_is_in_focused_editable(selection)) selection.removeAllRanges();
  const page_selection = getSelection();
  if (page_selection && !selection_is_in_focused_editable(page_selection)) page_selection.removeAllRanges();
  session = undefined;
  find_mode.end();
  clear_selection_colors();
}

// Something else moved a page selection since the last paint, such as a find, a drag or a click. A drag is taken whole in either mode, because the next key may switch the mode. A click keeps the anchor in visual mode and takes the click.
function adopt_page_selection(open: Session): void {
  for (const selection of selections_of(open.model_)) {
    const ends = ends_of(selection);
    const painted = open.painted_.find((record) => record.selection === selection)?.ends ?? [];
    if (ends.length === painted.length && ends.every((end, at) => end === painted[at])) continue;
    const found = selection_span(open.model_, selection);
    if (!found) continue;
    open.cursor = page_selection_cursor(open.model_, selection) ?? with_caret(open.cursor, found.first, is_visual(open.mode));
    open.goal_x_ = undefined;
    return;
  }
}

// A string is the failure message. The mode went back to normal then.
function ensure_session(mode: CaretMode): Session | string {
  const mode_changed = !session || session.mode !== mode;
  const model_before = session?.model_;
  if (session) session = rebuild_if_stale(session);
  if (session) adopt_page_selection(session);
  if (!session) {
    const started = start_session(mode);
    if (typeof started === "string") {
      page.desertfox_host.set_mode_("normal");
      return started;
    }
    session = started;
  }
  // Caret mode shows one character, so leaving visual mode drops the anchor.
  if (mode === "caret") session.cursor = { anchor: session.cursor.caret, caret: session.cursor.caret };
  session.mode = mode;
  paint(session);
  if (mode_changed && is_visual(mode)) visual_runs++;
  // A rebuild brings new trees, which have no selection style yet.
  if (mode_changed || session.model_ !== model_before) void apply_selection_colors(mode, session.model_.trees);
  return session;
}

// The caret goes to the count-th match, and the match is the current one for the highlights. With fewer matches the caret stays.
function move_to_find(open: Session, find: CharFind, count: number, again: boolean): void {
  const hit = find_char_hit(open.model_.text, open.cursor.caret, find, count, again);
  open.cursor = with_caret(open.cursor, hit?.caret ?? open.cursor.caret, is_visual(open.mode));
  if (hit) find_mode.set_current_(hit.match, open.model_);
  open.goal_x_ = undefined;
  paint(open);
}

const SESSION_MODES: readonly ExitDestination[] = ["caret", "visual", "visual_line"];

const sink_for = (mode: CaretMode) => ({
  // Showing the caret on entry is what makes entering the mode draw it at once.
  enter: () => {
    find_mode.end();
    const started = ensure_session(mode);
    if (typeof started === "string") page.desertfox_host.show_toast_(started);
  },
  on_token_: (token: string): "handled" | "pass" => {
    // Escape only ends the find, in the visual modes too.
    if (find_mode.is_live_()) return find_mode.on_token_(token);
    if (mode === "caret" || !is_escape(token)) return "pass";
    // Escape in a visual mode goes back to caret mode, and the keymap never sees it.
    page.desertfox_host.set_mode_("caret");
    return "handled";
  },
  // Between caret and the visual modes the highlight stays. Every other way out clears it.
  exit: (destination: ExitDestination) => {
    const is_search_line = destination === "cmdline" && searching_from !== undefined && searching_from === session;
    find_mode.end();
    if (!SESSION_MODES.includes(destination) && !is_search_line) end_session();
  },
});

// The key layer read the target, so a find key is a plain command. A line (`:caret.find x`) runs in normal mode, where there is no session to move.
const handle_find = (args: Record<string, unknown>): Outcome | undefined => {
  if (!SESSION_MODES.includes(page.desertfox_host.get_mode())) return;
  const open = ensure_session(session?.mode ?? "caret");
  if (typeof open === "string") return { ok: false, message: open };
  last_find = { char: args.char as string, direction: (args.direction as CharFind["direction"]) ?? "forward", till: args.till === true };
  find_mode.start();
  move_to_find(open, last_find, args.count as number, false);
  find_mode.refresh();
};

const handle_move = (args: Record<string, unknown>): Outcome | undefined => {
  const open = ensure_session(session?.mode ?? "caret");
  if (typeof open === "string") return { ok: false, message: open };
  if (args.unit === "find_repeat") {
    if (!last_find) return;
    const reversed = args.direction === "back";
    const direction = reversed === (last_find.direction === "back") ? "forward" : "back";
    move_to_find(open, { ...last_find, direction }, 1, true);
    find_mode.refresh();
    return;
  }
  find_mode.end();
  const unit = args.unit as MotionUnit;
  const direction = (args.direction as Direction | undefined) ?? "forward";
  let caret: number;
  if (is_screen_unit(unit)) {
    const target = screen_line_target(open.model_, open.cursor.caret, { unit, direction }, open.goal_x_);
    caret = target.index;
    open.goal_x_ = target.goal_x_;
  } else {
    caret = move_once(open.model_.text, open.cursor.caret, { unit, direction, big: args.big === true });
    open.goal_x_ = undefined;
  }
  open.cursor = with_caret(open.cursor, caret, is_visual(open.mode));
  paint(open);
};

// The router shows a refusal of its own, so the answer only decides whether a sequence goes on. Visual mode ends as the command goes out.
function run_in_background(id: string, args: Record<string, unknown>): Promise<Outcome> {
  const sent = browser.runtime.sendMessage({ type: "run", invocations: [{ id, args }], mode: "visual" }) as Promise<RunResponse>;
  page.desertfox_host.set_mode_("caret");
  return sent.then((answer): Outcome => (answer.ok ? answer : { ok: true, cancelled: true }), (): Outcome => ({ ok: false, message: "DesertFox background did not answer" }));
}

const handle_act = (args: Record<string, unknown>): Outcome | Promise<Outcome> | undefined => {
  find_mode.end();
  const open = ensure_session(session?.mode === "visual_line" ? "visual_line" : "visual");
  if (typeof open === "string") return { ok: false, message: open };
  const action = args.action as "yank" | "swap" | "search";
  if (action === "swap") {
    open.cursor = swap_ends(open.cursor);
    paint(open);
    return;
  }
  const text = selected_text(open.model_.text, open.painted_span_);
  if (action === "search") return run_in_background("open.search", { query: text });
  const run = visual_runs;
  // Visual mode stays until the copy is done, so a refused copy leaves the selection to retry.
  return yank_text(navigator.clipboard, text, args.register as string | undefined, {
    is_same_session_: () => visual_runs === run && session === open && is_visual(open.mode),
    toast: page.desertfox_host.show_toast_,
    leave_visual_: () => page.desertfox_host.set_mode_("caret"),
  });
};

// A refused object leaves the selection as it was. Line visual mode widens every selection to whole lines, so an object leaves it for character visual mode, as in vim.
const handle_object = (args: Record<string, unknown>): Outcome | undefined => {
  find_mode.end();
  if (session?.mode === "visual_line") page.desertfox_host.set_mode_("visual");
  const open = ensure_session("visual");
  if (typeof open === "string") return { ok: false, message: open };
  const cursor = select_object(open.model_.text, open.cursor, args as Parameters<typeof select_object>[2]);
  if (!cursor) return { ok: false, message: `No ${args.object} here` };
  open.cursor = cursor;
  open.goal_x_ = undefined;
  paint(open);
};

// Line breaks inside the selection are spaces, so a URL or a search sees one line. A blank selection stays selected.
const handle_open = (args: Record<string, unknown>): Outcome | Promise<Outcome> => {
  find_mode.end();
  const open = ensure_session(session?.mode === "visual_line" ? "visual_line" : "visual");
  if (typeof open === "string") return { ok: false, message: open };
  const text = selected_text(open.model_.text, open.painted_span_).replace(/\s+/g, " ").trim();
  if (text === "") return { ok: false, message: "Nothing to open in the selection" };
  return run_in_background("open.url", { url: text, where: args.where });
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
  const model = session?.model_ ?? build_text_model(document.body);
  if (model.text === "") return "No text here";
  const at = session ? undefined : (find.position(model) ?? first_visible_index(model));
  const cursor = session?.cursor ?? { anchor: at!, caret: at! };
  if (session && is_visual(session.mode)) {
    const { from, to } = session.painted_span_;
    return { pattern: `(?-i:${escape_regex(model.text.slice(from, to))})`, from: model.point_at_(from) };
  }
  const on_word = (index: number) => in_word(model.text, index);
  if (!on_word(cursor.caret)) return "No word under the caret";
  let first = cursor.caret;
  let end = cursor.caret + 1;
  while (on_word(first - 1)) first--;
  while (on_word(end)) end++;
  // Lookarounds and not `\b`, which treats a letter outside ASCII as a boundary.
  const pattern = `(?<![\\p{L}\\p{N}_])${escape_regex(model.text.slice(first, end))}(?![\\p{L}\\p{N}_])`;
  return { pattern, from: model.point_at_(first) };
}

// A session searches from its caret, so it first catches up with the page. Normal mode has no session.
const open_session_now = () => (session ? ensure_session(session.mode) : undefined);

// Moves the caret to the current match. True when the session changed and needs a paint.
// The session model holds only the text it was built from, so a match in text the page added since takes a rebuild.
function land_on_match(open: Session): boolean {
  const model_before = open.model_;
  // Paint runs before the next mode change, so a frame that left the page must leave the model first.
  rebuild_if_stale(open);
  let landed = find.position(open.model_);
  if (landed === undefined && rebuild_model(open)) landed = find.position(open.model_);
  const rebuilt = open.model_ !== model_before;
  // A rebuild brings new trees, which have no selection style yet.
  if (rebuilt) void apply_selection_colors(open.mode, open.model_.trees);
  if (landed === undefined) return rebuilt;
  open.cursor = with_caret(open.cursor, landed, is_visual(open.mode));
  open.goal_x_ = undefined;
  return true;
}

// `n` and `N`: step to the match, and an open session takes its caret there.
async function find_step(reverse: boolean): Promise<Outcome> {
  find_mode.end();
  const started = open_session_now();
  if (typeof started === "string") return { ok: false, message: started };
  const outcome = await find.step(reverse, started && started.model_.point_at_(started.cursor.caret));
  const open = session;
  if (open && outcome.ok && !("cancelled" in outcome && outcome.cancelled) && land_on_match(open)) paint(open);
  return outcome;
}

// `*` and `#`: search for the word or selection at once, and let an open session follow the match.
async function find_word(direction: "forward" | "backward"): Promise<Outcome> {
  find_mode.end();
  const started = open_session_now();
  if (typeof started === "string") return { ok: false, message: started };
  const target = word_target();
  if (typeof target === "string") return { ok: false, message: target };
  const outcome = await find.jump(target.pattern, direction, target.from);
  const open = session;
  if (open && outcome.ok && !("cancelled" in outcome && outcome.cancelled) && land_on_match(open)) paint(open);
  return outcome;
}

// The search line closed on a session. Enter takes the caret to the match, and either way the mode goes back to the session's.
async function end_session_search(from: Session, keep: boolean): Promise<void> {
  if (session !== from) return;
  // Painted before the mode change, because entering the mode adopts any page selection that differs from the last paint.
  if (keep && land_on_match(from)) paint(from);
  page.desertfox_host.set_mode_(from.mode);
}

// A bundle may run twice, and a second run would hold fresh state next to the first.
if (!page.desertfox_caret_ready) {
  page.desertfox_caret_ready = true;
  page.desertfox_host.register_sink_("caret", sink_for("caret"));
  page.desertfox_host.register_sink_("visual", sink_for("visual"));
  page.desertfox_host.register_sink_("visual_line", sink_for("visual_line"));
  // The one way into a caret mode from outside, so the mode is set only once its sink is in.
  page.desertfox_host.register_handler_("caret.mode", (args) => page.desertfox_host.set_mode_(args.mode as CaretMode));
  page.desertfox_host.register_handler_("caret.move", handle_move);
  page.desertfox_host.register_handler_("caret.find", handle_find);
  page.desertfox_host.register_handler_("visual.act", handle_act);
  page.desertfox_host.register_handler_("visual.object", handle_object);
  page.desertfox_host.register_handler_("visual.open", handle_open);
  page.desertfox_host.register_handler_("find.open", (args) => {
    find_mode.end();
    const direction = args.direction === "backward" ? "backward" : "forward";
    if (args.source === "word") return find_word(direction);
    const started = open_session_now();
    if (typeof started === "string") return { ok: false, message: started };
    searching_from = started;
    find.begin(direction, started?.model_.point_at_(started.cursor.caret));
    return page.desertfox_host.run_command_("cmdline.open", "cmdline", { search: direction });
  });
  page.desertfox_host.register_handler_("find.next", () => find_step(false));
  page.desertfox_host.register_handler_("find.prev", () => find_step(true));
  // Called by the command line while it is open, and not by any key.
  page.desertfox_host.register_handler_("find.live", (args) => find.update(args.text as string, args.report as (status: string) => void));
  page.desertfox_host.register_handler_("find.end", async (args) => {
    const keep = args.keep === true;
    await find.end(keep);
    const from = searching_from;
    searching_from = undefined;
    if (from) await end_session_search(from, keep);
  });
  page.desertfox_host.register_handler_("find.clear", () => find.clear());
}
