// The `caret` bundle: caret mode, both visual modes, and page search. Loaded on the first entry into one of these modes or the first search, it registers a sink for each mode and
// the handlers of `caret.move`, `visual.act`, `visual.object`, `visual.open` and the `find.*` commands.

import type { Outcome, RunResponse } from "../../shared/messages.ts";
import type { BundleHostApi, ExitDestination } from "../bundle_host.ts";
import { find_char_hit, find_char_matches, is_screen_unit, move_once } from "./motion.ts";
import type { CharFind, Direction, MotionUnit, ScreenMotion } from "./motion.ts";
import { yank_text } from "./copy_text.ts";
import { create_find_mode, is_escape } from "./find_mode.ts";
import { CHAR_FIND_NAMES, create_painter } from "./find_paint.ts";
import type { FindColors } from "./find_paint.ts";
import type { FindView } from "./find_mode.ts";
import { browser_find_deps, create_find, read_find_colors } from "./find_session.ts";
import { create_page_text } from "./page_text.ts";
import { select_object } from "./text_object.ts";
import { scroll_to_index, screen_line_target } from "./screen_line.ts";
import { create_selection_mirror, selections_of } from "./selection_mirror.ts";
import { create_sessions, SESSION_MODES } from "./caret_session.ts";
import type { Session } from "./caret_session.ts";
import { is_visual, line_span, selected_text, selected_span, swap_ends, with_caret } from "./selection_state.ts";
import type { CaretMode, Cursor, Span } from "./selection_state.ts";
import { frame_document, trees_alive } from "./text_model.ts";
import type { DomPoint, TextModel } from "./text_model.ts";
import { page_selection_cursor } from "./page_selection.ts";
import { first_visible_index, visible_index_range } from "./start_point.ts";
import { indexes_in_range, pad_range } from "./visible_range.ts";

// `desertfox_caret_target` is the element a hint picked. The hints bundle sets it just before it enters the mode.
type CaretWindow = { desertfox_host: BundleHostApi; desertfox_caret_ready?: true; desertfox_caret_target?: Element };
const page = window as unknown as CaretWindow;
const page_text = create_page_text();
const mirror = create_selection_mirror();
const find = create_find(page.desertfox_host, browser_find_deps(page_text, mirror));

// The last find for `;` and `,`. Per page, and not a register.
let last_find: CharFind | undefined;

// The matches of the last find's character that stay lit while the find is live. Exact case, so the keymap's case means what it says.
const char_painter = create_painter(CHAR_FIND_NAMES);
let char_matches: { model_: TextModel; char: string; from: number[] } | undefined;

// `view.current` is where the match the caret stands at or next to sits. A find that found nothing has none, and a new model has other positions, so both fall back to the caret.
function show_char_matches(view: FindView<FindColors>): void {
  const open = sessions.open_();
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

const SCREEN_LINE_START: ScreenMotion = { unit: "line_start", direction: "back" };
const SCREEN_LINE_END: ScreenMotion = { unit: "line_end", direction: "forward" };

// Line visual mode asks layout for its line bounds, so it measures through the mirror.
function span_of(open: Session): Span {
  if (open.mode !== "visual_line") return selected_span(open.cursor);
  return mirror.measure(open.model_, () =>
    line_span(open.cursor, {
      start_of_: (index) => screen_line_target(open.model_, index, SCREEN_LINE_START).index,
      end_of: (index) => screen_line_target(open.model_, index, SCREEN_LINE_END).index,
    }),
  );
}

function paint(open: Session): void {
  mirror.paint(open.model_, (open.span_ = span_of(open)), open.mode);
  scroll_to_index(open.model_, open.cursor.caret);
}

// Where a new session starts: the text of the picked element or the next text after it, else the match a search stands on while no later selection took the place, else the page's own drag (whole in visual mode, its release end in caret mode), else the caret's place in the page's own selection if it is on screen, else the first visible text.
// A string is the reason no session could start.
function start_session(mode: CaretMode): { model_: TextModel; cursor: Cursor } | string {
  const target = page.desertfox_caret_target;
  delete page.desertfox_caret_target;
  const is_other_site_frame = target !== undefined && (target.localName === "iframe" || target.localName === "frame") && !frame_document(target);
  if (is_other_site_frame) {
    return "Caret cannot reach a frame from another site";
  }
  // The model covers the whole page, so motion is not trapped in the element.
  // Read again even while the held model is current: a plain element that attached a shadow root since fired no mutation.
  const model = page_text.read(target);
  if (model.text === "") return "No text here";
  const dragged = target === undefined ? selections_of(model).flatMap((selection) => page_selection_cursor(model, selection) ?? [])[0] : undefined;
  // A search position is valid only while no selection came after it, so it is newer than any drag and wins.
  const searched = target === undefined ? find.position(model) : undefined;
  if (is_visual(mode) && dragged && searched === undefined) return { model_: model, cursor: dragged };
  const caret = target === undefined ? (searched ?? dragged?.caret ?? first_visible_index(model)) : model.start_index_;
  if (caret === undefined) return "No text here";
  return { model_: model, cursor: { anchor: caret, caret } };
}

// With no session open and no search that goes on, nothing reads the page text, so the page stops being watched.
function release_if_idle(): void {
  if (!sessions.open_() && !find.uses_page_text_()) page_text.release();
}

const sessions = create_sessions({
  host: page.desertfox_host,
  page_text,
  start_: start_session,
  foreign_move_: (open) => mirror.foreign_move_(open.model_),
  first_visible_: first_visible_index,
  paint_: paint,
  set_mode_colors_: (mode) => void mirror.set_mode_colors_(mode),
  ended_: () => {
    mirror.clear();
    find_mode.end();
    release_if_idle();
  },
});

// What a handler answers when it got no session: the reason, or nothing more to say when the sink's entry already showed it.
const no_session = (failed: string | undefined): Outcome => (failed ? { ok: false, message: failed } : { ok: true, cancelled: true });

// The caret goes to the count-th match, and the match is the current one for the highlights. With fewer matches the caret stays.
function move_to_find(open: Session, find: CharFind, count: number, again: boolean): void {
  const hit = find_char_hit(open.model_.text, open.cursor.caret, find, count, again);
  open.cursor = with_caret(open.cursor, hit?.caret ?? open.cursor.caret, is_visual(open.mode));
  if (hit) find_mode.set_current_(hit.match, open.model_);
  open.goal_x_ = undefined;
  paint(open);
}

const sink_for = (mode: CaretMode) => ({
  // Showing the caret on entry is what makes entering the mode draw it at once.
  enter: () => {
    find_mode.end();
    const failed = sessions.enter_(mode);
    if (failed) page.desertfox_host.show_toast_(failed);
  },
  on_token_: (token: string): "handled" | "pass" => {
    // A click ended the visual mode, so the keymap reads this key in caret mode.
    if (mode !== "caret" && sessions.take_click_()) return "pass";
    // Escape only ends the find, in the visual modes too.
    if (find_mode.is_live_()) return find_mode.on_token_(token);
    if (mode === "caret" || !is_escape(token)) return "pass";
    // Escape in a visual mode goes back to caret mode, and the keymap never sees it.
    page.desertfox_host.set_mode_("caret");
    return "handled";
  },
  live_: find_mode.is_live_,
  exit: (destination: ExitDestination) => {
    find_mode.end();
    sessions.exit_(destination);
  },
});

// The key layer read the target, so a find key is a plain command. A line (`:caret.find x`) runs in normal mode, where there is no session to move.
const handle_find = (args: Record<string, unknown>): Outcome | undefined => {
  if (!SESSION_MODES.includes(page.desertfox_host.get_mode())) return;
  const open = sessions.current_();
  if (typeof open !== "object") return no_session(open);
  last_find = { char: args.char as string, direction: (args.direction as CharFind["direction"]) ?? "forward", till: args.till === true };
  find_mode.start();
  move_to_find(open, last_find, args.count as number, false);
  find_mode.refresh();
};

const handle_move = (args: Record<string, unknown>): Outcome | undefined => {
  const open = sessions.require_("caret");
  if (typeof open !== "object") return no_session(open);
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
    const target = mirror.measure(open.model_, () => screen_line_target(open.model_, open.cursor.caret, { unit, direction }, open.goal_x_));
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
async function run_in_background(id: string, args: Record<string, unknown>): Promise<Outcome> {
  const sent = browser.runtime.sendMessage({ type: "run", invocations: [{ id, args }], mode: "visual" }) as Promise<RunResponse>;
  page.desertfox_host.set_mode_("caret");
  let answer: RunResponse;
  try {
    answer = await sent;
  } catch {
    return { ok: false, message: "DesertFox background did not answer" };
  }
  return answer.ok ? answer : { ok: true, cancelled: true };
}

const handle_act = (args: Record<string, unknown>): Outcome | Promise<Outcome> | undefined => {
  find_mode.end();
  const open = sessions.selected_();
  if (typeof open === "string") return { ok: false, message: open };
  const action = args.action as "yank" | "swap" | "search";
  if (action === "swap") {
    open.cursor = swap_ends(open.cursor);
    paint(open);
    return;
  }
  const text = selected_text(open.model_.text, open.span_);
  if (action === "search") return run_in_background("open.search", { query: text });
  const run = open.generation_;
  // Visual mode stays until the copy is done, so a refused copy leaves the selection to retry.
  return yank_text(navigator.clipboard, text, args.register as string | undefined, {
    is_same_session_: () => sessions.is_run_(run) && is_visual(open.mode),
    toast: page.desertfox_host.show_toast_,
    leave_visual_: () => page.desertfox_host.set_mode_("caret"),
  });
};

// A refused object leaves the selection as it was. Line visual mode widens every selection to whole lines, so an object leaves it for character visual mode, as in vim.
const handle_object = (args: Record<string, unknown>): Outcome | undefined => {
  find_mode.end();
  const open = sessions.require_("visual");
  if (typeof open !== "object") return no_session(open);
  const cursor = select_object(open.model_.text, open.cursor, args as Parameters<typeof select_object>[2]);
  if (!cursor) return { ok: false, message: `No ${args.object} here` };
  open.cursor = cursor;
  open.goal_x_ = undefined;
  paint(open);
};

// Line breaks inside the selection are spaces, so a URL or a search sees one line. A blank selection stays selected.
const handle_open = (args: Record<string, unknown>): Outcome | Promise<Outcome> => {
  find_mode.end();
  const open = sessions.selected_();
  if (typeof open === "string") return { ok: false, message: open };
  const text = selected_text(open.model_.text, open.span_).replace(/\s+/g, " ").trim();
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
  const session = sessions.open_();
  const model = session?.model_ ?? page_text.current();
  if (model.text === "") return "No text here";
  const at = session ? undefined : (find.position(model) ?? first_visible_index(model));
  const cursor = session?.cursor ?? { anchor: at!, caret: at! };
  if (session && is_visual(session.mode)) {
    const { from, to } = session.span_;
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

// After a search the session catches up with the page, and with `take_match` its caret goes to the current match. It paints when either changed something.
// A match in text the page added since the session read it needs the catch-up first.
function follow_search(open: Session, take_match: boolean): void {
  const model_before = open.model_;
  // Paint runs before the next mode change, so a frame that left the page must leave the model first.
  if (!sessions.read_again_(open)) return sessions.end_empty_();
  const landed = take_match ? find.position(open.model_) : undefined;
  if (landed !== undefined) {
    open.cursor = with_caret(open.cursor, landed, is_visual(open.mode));
    open.goal_x_ = undefined;
  }
  if (landed !== undefined || open.model_ !== model_before) paint(open);
}

const found_match = (outcome: Outcome) => outcome.ok && !("cancelled" in outcome && outcome.cancelled);

// A search step follows only the run it started from, so it takes the generation before its await: a mode switch to another visual run bumps the generation on the same session object.
function follow_step(started: Session | undefined, run: number | undefined, outcome: Outcome): void {
  if (started && sessions.is_run_(run)) follow_search(started, found_match(outcome));
}

// `n` and `N`: step to the match, and an open session takes its caret there. A session searches from its caret, so it first catches up with the page. Normal mode has no session.
async function find_step(reverse: boolean): Promise<Outcome> {
  find_mode.end();
  try {
    const started = sessions.current_();
    if (typeof started === "string") return { ok: false, message: started };
    const run = started?.generation_;
    const outcome = await find.step(reverse, started && started.model_.point_at_(started.cursor.caret));
    follow_step(started, run, outcome);
    return outcome;
  } finally {
    release_if_idle();
  }
}

// `*` and `#`: search for the word or selection at once, and let an open session follow the match.
// A refusal releases the page text too, because `word_target` may have read it.
async function find_word(direction: "forward" | "backward"): Promise<Outcome> {
  find_mode.end();
  try {
    const started = sessions.current_();
    if (typeof started === "string") return { ok: false, message: started };
    const target = word_target();
    if (typeof target === "string") return { ok: false, message: target };
    const run = started?.generation_;
    const outcome = await find.jump(target.pattern, direction, target.from);
    follow_step(started, run, outcome);
    return outcome;
  } finally {
    release_if_idle();
  }
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
    const started = sessions.current_();
    if (typeof started === "string") return { ok: false, message: started };
    sessions.hold_for_search_();
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
    // The search line closed on a session. Enter takes the caret to the match, and either way the mode goes back to the session's.
    sessions.release_search_((open) => follow_search(open, keep));
    release_if_idle();
  });
  page.desertfox_host.register_handler_("find.clear", () => find.clear());
}
