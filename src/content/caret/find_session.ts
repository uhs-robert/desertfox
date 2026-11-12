// Page search: the live search while the line is open, the match that stays after Enter or Escape, and n and N.
// The line (the cmdline bundle) reaches it through `begin`, `update` and `end`. The keys reach it through `step` and `clear`.

import type { FindScan, FindScanAnswer, Outcome, RegisterRead, RegisterWrite } from "../../shared/messages.ts";
import type { BundleHostApi } from "../bundle_host.ts";
import { collect_matches, compile_query, describe_match, describe_timeout, nearest_match, opposite, step_match } from "./find_match.ts";
import type { Direction, Fallback, Matches, ScanRegex, Search, Slicing } from "./find_match.ts";
import { create_painter } from "./find_paint.ts";
import type { FindColors, Painter } from "./find_paint.ts";
import { scroll_to_index } from "./screen_line.ts";
import { find_colors_of, stored_theme } from "./selection_colors.ts";
import { first_visible_index } from "./start_point.ts";
import type { PageText } from "./page_text.ts";
import type { SelectionMark, SelectionMirror } from "./selection_mirror.ts";
import { MAX_TEXT_CHARS, trees_alive } from "./text_model.ts";
import type { DomPoint, TextModel } from "./text_model.ts";

// What the engine needs of the host script. A bundle reaches it through `window.desertfox_host`.
type Host = Pick<BundleHostApi, "show_toast_">;

type Found = { model_: TextModel; query: string; fallback: Fallback | undefined; direction: Direction; matches: Matches; current: number };

// While the line is open. `start` is where the search began, so each keystroke looks from the same place.
type Live = {
  model_: TextModel;
  direction: Direction;
  start: number;
  // `start` as a point in the page, so a rebuilt model keeps the same origin.
  start_point_: DomPoint | undefined;
  // Bumped by each keystroke and by the end of the search. A scan or paint that finds it changed drops its work.
  generation_: number;
  // The text of the line as of the last keystroke.
  text: string;
  // The text of the latest run when its regex ran past the time limit, so Enter searches it as text. Each run clears it as it starts.
  timed_out_: string | undefined;
  found: Found | undefined;
  pending: Promise<void>;
  colors: Promise<FindColors>;
  // Set once the line is closing. Settles when the search has been kept or dropped.
  finished: Promise<void> | undefined;
};

// Everything that touches the page or storage, so the state machine runs under test with fakes.
export type FindDeps = {
  // Shared with the caret session, so both read one model and one rule for when it is stale.
  page_text: PageText;
  start_index_: (model: TextModel) => number;
  painter: Painter;
  scroll_to_: (model: TextModel, first_index: number, last_index: number, bottom_inset: number) => void;
  read_colors_: () => Promise<FindColors>;
  get_register_: (name: string) => Promise<string | undefined>;
  set_register_: (name: string, text: string) => Promise<void>;
  slicing: (is_stale: () => boolean) => Slicing;
  scan_regex: ScanRegex;
  // Tells whether a document's own selection moved since the search stood on its match. A click or a drag (from the same anchor too) moves it, which makes a later position win over an older match.
  selections: Pick<SelectionMirror, "mark" | "moved_since_">;
};

const SLICE_MS = 8;
// The command line covers about this much of the bottom edge while it is open.
const LINE_HEIGHT_PX = 56;
const FALLBACK_COLORS: FindColors = {
  all: { dark: ["#666666", "#f5f5dc"], light: ["#e1b69d", "#4e260e"] },
  current: { dark: ["#cdc673", "#0c0e13"], light: ["#dd6f6f", "#350808"] },
};
// Register `/` holds the query. Its direction sits in a register of its own, since a register holds text only.
const QUERY_REGISTER = "/";
const DIRECTION_REGISTER = "/:direction";

// The search pair for all matches and the current-match pair for the one the search stands on.
export async function read_find_colors(): Promise<FindColors> {
  const theme = await stored_theme();
  return theme ? find_colors_of(theme) : FALLBACK_COLORS;
}

export const browser_find_deps = (page_text: PageText, selections: FindDeps["selections"]): FindDeps => ({
  page_text,
  start_index_: (model) => (model.text === "" ? 0 : first_visible_index(model)),
  painter: create_painter(),
  scroll_to_: (model, first_index, last_index_, bottom_inset_) => scroll_to_index(model, first_index, { bottom_inset_, last_index_ }),
  read_colors_: read_find_colors,
  get_register_: async (name) => {
    const value = await (browser.runtime.sendMessage({ type: "register_read", name } satisfies RegisterRead) as Promise<unknown>);
    return typeof value === "string" ? value : undefined;
  },
  set_register_: async (name, text) => void (await browser.runtime.sendMessage({ type: "register_write", name, text } satisfies RegisterWrite)),
  slicing: (is_stale_) => ({ is_stale_, yield_to_page_: () => new Promise<void>((resume) => setTimeout(resume, 0)), now: () => performance.now(), slice_ms_: SLICE_MS }),
  scan_regex: (text, { source, flags }) => browser.runtime.sendMessage({ type: "find_scan", text, source, flags } satisfies FindScan) as Promise<FindScanAnswer>,
  selections,
});

// Said under the line and in the toast when the model stopped at the size cap.
const cut_note = (model: TextModel, message: string) => (model.truncated ? `${message} (long page: only the first ${MAX_TEXT_CHARS / 1_000_000} million characters are searched)` : message);

export function create_find(host: Host, deps: FindDeps) {
  const { painter, page_text } = deps;
  let live: Live | undefined;
  // The match the search stands on, after Enter or Escape. Escape clears the highlights and keeps it, so `n` goes on from it and caret mode can start at it.
  let shown: Found | undefined;
  let shown_mark: SelectionMark = [];
  let highlighted = false;
  let last: { query: string; direction: Direction } | undefined;
  // Bumped by each `step` that has to scan again, so an older scan does not paint over a newer one.
  let step_generation = 0;
  // Presses of `n` and `N` run one after the other, so each moves one match. A press that ran beside another would cancel it through `step_generation`.
  let steps: Promise<void> = Promise.resolve();
  // The last query whose regex ran past the time limit. `n` and `N` search it as text at once, so a page whose text keeps changing does not cost each press the full limit.
  // Typing it on the line runs the regex again, and an answer clears it.
  let timed_out_query: string | undefined;
  // Where a jump to a word starts, as a point in the page. `step_once` consumes it.
  let origin: DomPoint | undefined;

  const paint = (found: Found, colors: FindColors) => {
    painter.paint(found.model_, found.matches, found.current, colors);
    highlighted = true;
  };

  const drop_highlights = () => {
    painter.clear();
    highlighted = false;
  };

  const scroll_to = (found: Found, inset: number) => {
    try {
      deps.scroll_to_(found.model_, found.matches.from[found.current]!, found.matches.to[found.current]! - 1, inset);
    } catch {}
  };

  const remember = async (query: string, direction: Direction) => {
    last = { query, direction };
    await Promise.all([deps.set_register_(QUERY_REGISTER, query), deps.set_register_(DIRECTION_REGISTER, direction)]);
  };

  async function recall(): Promise<typeof last> {
    if (last) return last;
    const [query, direction] = await Promise.all([deps.get_register_(QUERY_REGISTER), deps.get_register_(DIRECTION_REGISTER)]);
    return (last = query !== undefined && query !== "" && (direction === "forward" || direction === "backward") ? { query, direction } : undefined);
  }

  // Where the current match of `old` sits in `model`. Undefined when its text has left the page.
  const carry_match = (old: Found, model: TextModel) => page_text.carry(old.model_, old.matches.from[old.current]!, model);

  const stand_on = (found: Found) => {
    shown = found;
    shown_mark = deps.selections.mark(found.model_);
  };

  // `as_text_` is for Enter: it searches the text fallback that a costly or timed-out pattern skipped while typing.
  async function run_update(open: Live, text: string, run: number, report: (status: string) => void, as_text = false): Promise<void> {
    const is_stale = () => live !== open || open.generation_ !== run;
    const query = compile_query(text);
    if (!query) {
      open.found = undefined;
      drop_highlights();
      return report("");
    }
    if (!page_text.is_current(open.model_)) {
      open.model_ = page_text.current();
      open.start = page_text.locate(open.start_point_, open.model_) ?? deps.start_index_(open.model_);
    }
    // A pattern typed one key at a time passes through costly shapes such as `(a+)+`. It is not searched, and the results of the last keystroke stay on the page.
    if (query.fallback === "costly" && !as_text) return report(`Pattern too slow as a regex: ${text}`);
    const [search, fallback] = as_text ? [query.as_text_, "costly" as const] : [query.search, query.fallback];
    open.timed_out_ = undefined;
    const matches = await collect_matches(open.model_.text, search, deps.slicing(is_stale), deps.scan_regex);
    if (!matches || is_stale()) return;
    // As with a costly shape, the results of the last keystroke stay on the page.
    if (matches === "timeout") {
      open.timed_out_ = timed_out_query = text;
      return report(describe_timeout(text));
    }
    if (search.kind === "regex" && timed_out_query === text) timed_out_query = undefined;
    const colors = await open.colors;
    if (is_stale()) return;
    // The page can lose a frame while the scan runs. Then the match positions no longer fit the text, so the scan starts over.
    // Other page changes wait for the next keystroke: a page that changes without pause would restart a long scan forever.
    if (!trees_alive(open.model_)) return run_update(open, text, run, report, as_text);
    const first = nearest_match(matches.from, open.start, open.direction);
    if (!first) {
      open.found = undefined;
      drop_highlights();
      return report(cut_note(open.model_, describe_match(text, 0, 0, fallback)));
    }
    const found: Found = { model_: open.model_, query: text, fallback, direction: open.direction, matches, current: first.index };
    open.found = found;
    paint(found, colors);
    scroll_to(found, LINE_HEIGHT_PX);
    report(cut_note(open.model_, describe_match(text, matches.from.length, first.index, fallback, first.wrapped)));
  }

  // The index to search from for a jump: forward skips the word itself, which starts at the origin.
  const from_origin = (model: TextModel, direction: Direction): number | undefined => {
    const index = page_text.locate(origin, model);
    return index === undefined ? undefined : direction === "forward" ? index + 1 : index;
  };

  // Done on a match. Failed when there is no previous search or no match, with the message left for the caller to show.
  // Cancelled when a search line or a newer step took over.
  async function step_once(reverse: boolean): Promise<Outcome> {
    const taken_over: Outcome = { ok: true, cancelled: true };
    // Enter closes the line before its search has finished, so a key typed right after it waits for that.
    await live?.finished;
    if (live) return taken_over;
    const run = ++step_generation;
    const previous = await recall();
    if (run !== step_generation) return taken_over;
    if (!previous) return { ok: false, message: "No previous search" };
    const direction = reverse ? opposite(previous.direction) : previous.direction;
    const colors = await deps.read_colors_();
    const kept = shown?.query === previous.query ? shown : undefined;
    let found = kept && page_text.is_current(kept.model_) ? kept : undefined;
    let wrapped = false;
    // A step from a caret (visual mode) looks from the caret, as the search line does, and not from the last match.
    if (found && !origin) {
      const stepped = step_match(found.current, found.matches.from.length, direction);
      found = { ...found, current: stepped.index };
      wrapped = stepped.wrapped;
    } else {
      const query = found ? undefined : compile_query(previous.query);
      if (!found && !query) return { ok: false, message: "No previous search" };
      const model = found?.model_ ?? page_text.current();
      const scan = (search: Search) => collect_matches(model.text, search, deps.slicing(() => run !== step_generation), deps.scan_regex);
      let fallback = found ? found.fallback : query!.fallback;
      const known_too_slow = !found && timed_out_query === previous.query;
      let matches = found?.matches ?? (known_too_slow ? "timeout" : await scan(query!.search));
      // n and N commit the pattern as Enter does, so a regex past the time limit is searched as text.
      if (matches === "timeout") {
        timed_out_query = previous.query;
        fallback = "costly";
        matches = await scan(query!.as_text_);
      }
      if (!matches || matches === "timeout" || run !== step_generation) return taken_over;
      // After a rebuild the step goes on from the match the user was on, when its text is still on the page.
      const carried = kept && carry_match(kept, model);
      const start = from_origin(model, direction) ?? (carried === undefined ? deps.start_index_(model) : direction === "forward" ? carried + 1 : carried);
      const first = nearest_match(matches.from, start, direction);
      if (!first) return { ok: false, message: describe_match(previous.query, 0, 0, fallback) };
      found = { model_: model, query: previous.query, fallback, direction: previous.direction, matches, current: first.index };
      wrapped = first.wrapped;
    }
    stand_on(found);
    paint(found, colors);
    scroll_to(found, 0);
    host.show_toast_(cut_note(found.model_, describe_match(found.query, found.matches.from.length, found.current, found.fallback, wrapped)));
    return { ok: true };
  }

  return {
    // `/` or `?` was pressed. The page is read again, because a plain element that attached a shadow root since the last read fired no mutation.
    // `from` is where a visual session has its caret, so the search goes on from there and not from the top of the screen.
    begin(direction: Direction, from?: DomPoint): void {
      drop_highlights();
      // The old match belongs to the old search, so a search that finds nothing must not leave it as the position.
      shown = undefined;
      step_generation++;
      const model = page_text.read();
      origin = from;
      const start = from_origin(model, direction) ?? deps.start_index_(model);
      origin = undefined;
      live = { model_: model, direction, start, start_point_: page_text.point_of(model, start), generation_: 0, text: "", timed_out_: undefined, found: undefined, pending: Promise.resolve(), colors: deps.read_colors_(), finished: undefined };
    },

    // The text of the line changed. `report` gets the line to show under it.
    update(text: string, report: (status: string) => void): void {
      const open = live;
      if (!open || open.finished) return;
      open.text = text;
      const run = ++open.generation_;
      open.pending = run_update(open, text, run, report).catch((error) => host.show_toast_(`Search failed: ${(error as Error).message}`));
    },

    // The line closed. Enter (`keep`) waits for the scan of the last keystroke and leaves the highlights. Escape stops the scan and clears them.
    // Both leave the page where it is, keep the query as the last search and keep the match the search stands on.
    end(keep: boolean): Promise<void> {
      const open = live;
      if (!open) return Promise.resolve();
      if (open.finished) return open.finished;
      if (!keep) open.generation_++;
      open.finished = (async () => {
        if (keep) await open.pending;
        // Enter commits the pattern, so the text fallback that was skipped while typing runs now.
        const text_fallback_skipped = open.timed_out_ === open.text || compile_query(open.text)?.fallback === "costly";
        // A timeout of the last run wins over older results of the same text, which stay on the page only while typing.
        const found_is_current = open.found?.query === open.text && open.timed_out_ !== open.text;
        if (keep && live === open && !found_is_current && text_fallback_skipped) await run_update(open, open.text, ++open.generation_, () => {}, true);
        // A new search may have begun while the scan finished, and it owns the page now.
        if (live !== open) return;
        live = undefined;
        if (!keep) drop_highlights();
        if (open.found?.query === open.text) stand_on(open.found);
        else if (keep) drop_highlights();
        if (open.text !== "") await remember(open.text, open.direction);
      })();
      return open.finished;
    },

    // The key `*` or `#`: search `pattern` as the last search from `from`, with no line. The same outcomes as `step`.
    jump(pattern: string, direction: Direction, from: DomPoint): Promise<Outcome> {
      const done = steps.then(async (): Promise<Outcome> => {
        await live?.finished;
        if (live) return { ok: true, cancelled: true };
        drop_highlights();
        shown = undefined;
        step_generation++;
        await remember(pattern, direction);
        origin = from;
        try {
          return await step_once(false);
        } finally {
          origin = undefined;
        }
      });
      steps = done.then(() => {}, () => {});
      return done;
    },

    // The key `n` or `N`: repeat the last search in its direction, or the other way.
    // `from` is the caret of a visual session. The step then goes on from it and not from the last match.
    step(reverse: boolean, from?: DomPoint): Promise<Outcome> {
      const done = steps.then(async () => {
        origin = from;
        try {
          return await step_once(reverse);
        } finally {
          origin = undefined;
        }
      });
      steps = done.then(() => {}, () => {});
      return done;
    },

    // Escape in normal mode: the highlights go, and the search keeps its place.
    clear(): void {
      if (highlighted && !live) drop_highlights();
    },

    // True while the line is open or a match stays for `n`, `N` and a new session to go on from.
    uses_page_text_: (): boolean => live !== undefined || shown !== undefined,

    // Where the search stands in `model`, for a caret or visual session that starts at it. A later click or selection takes the position, so nothing then.
    position(model: TextModel): number | undefined {
      return shown && !deps.selections.moved_since_(shown_mark) ? carry_match(shown, model) : undefined;
    },
  };
}
