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
import { build_text_model, documents_of, host_gained_root, MAX_TEXT_CHARS, trees_alive } from "./text_model.ts";
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
  build_model_: () => TextModel;
  start_index_: (model: TextModel) => number;
  painter: Painter;
  scroll_to_: (model: TextModel, first_index: number, last_index: number, bottom_inset: number) => void;
  read_colors_: () => Promise<FindColors>;
  get_register_: (name: string) => Promise<string | undefined>;
  set_register_: (name: string, text: string) => Promise<void>;
  slicing: (is_stale: () => boolean) => Slicing;
  scan_regex: ScanRegex;
  // Where each document's own selection sits, both ends: a drag from the same anchor to a new point moves it too. A click moves it, which makes a later position win over an older match.
  selection_key_: (model: TextModel) => unknown[];
  // Calls `on_change` when text changes in the page or in any of the trees the model read, or when a frame it met loads. The returned function points the watcher at a new model.
  watch_page_: (on_change: () => void) => (model: TextModel) => void;
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

// An element of DesertFox itself (the command line, the surfaces) comes and goes with a search, and its text is not in the model.
// Marked by an attribute: a style check such as `all: initial` stops holding once the element sets a longhand, as the command line does when it resizes.
const is_own_element = (node: Node) => node.nodeType === 1 && (node as Element).hasAttribute("data-desertfox-layer");

export const is_page_change = (record: MutationRecord) =>
  record.type === "characterData" || [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some((node) => !is_own_element(node));

// The search pair for all matches and the current-match pair for the one the search stands on.
export async function read_find_colors(): Promise<FindColors> {
  const theme = await stored_theme();
  return theme ? find_colors_of(theme) : FALLBACK_COLORS;
}

// One observer for the page and every tree of the model, the empty ones too: a shadow root or frame document that was empty at build time can fill later. A frame that navigates fires no mutation in its parent, so its `load` event stands in.
export const page_watcher = (observer_class: typeof MutationObserver) => (on_change: () => void) => {
  const observer = new observer_class((records) => records.some(is_page_change) && on_change());
  let frame_listening = new AbortController();
  return (model: TextModel) => {
    observer.disconnect();
    frame_listening.abort();
    frame_listening = new AbortController();
    for (const tree of [document, ...model.trees, ...model.empty_trees_]) observer.observe(tree, { childList: true, characterData: true, subtree: true });
    for (const frame of model.frames) frame.addEventListener("load", on_change, { signal: frame_listening.signal });
  };
};

const browser_deps = (): FindDeps => ({
  build_model_: () => build_text_model(document.body),
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
  selection_key_: (model) => documents_of(model).flatMap((owner) => [owner.getSelection()?.anchorNode, owner.getSelection()?.anchorOffset, owner.getSelection()?.focusNode, owner.getSelection()?.focusOffset]),
  watch_page_: (on_change) => page_watcher(MutationObserver)(on_change),
});

// Said under the line and in the toast when the model stopped at the size cap.
const cut_note = (model: TextModel, message: string) => (model.truncated ? `${message} (long page: only the first ${MAX_TEXT_CHARS / 1_000_000} million characters are searched)` : message);

// Where the current match of `old` sits in a rebuilt model. Undefined when its text has left the page: a node of a removed frame throws on any read.
function carry_index(old: Found, model: TextModel): number | undefined {
  try {
    const { node, offset } = old.model_.point_at_(old.matches.from[old.current]!);
    return model.index_of_(node, offset);
  } catch {
    return undefined;
  }
}

export function create_find(host: Host, deps: FindDeps = browser_deps()) {
  const { painter } = deps;
  let live: Live | undefined;
  // The match the search stands on, after Enter or Escape. Escape clears the highlights and keeps it, so `n` goes on from it and caret mode can start at it.
  let shown: Found | undefined;
  let shown_selection: unknown[] = [];
  let highlighted = false;
  let last: { query: string; direction: Direction } | undefined;
  // Bumped by each `step` that has to scan again, so an older scan does not paint over a newer one.
  let step_generation = 0;
  // Presses of `n` and `N` run one after the other, so each moves one match. A press that ran beside another would cancel it through `step_generation`.
  let steps: Promise<void> = Promise.resolve();
  // The page changed its text since the search read its model, so the model is read again before it is used.
  let page_changed = false;
  let retarget_watcher: ((model: TextModel) => void) | undefined;
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

  // Every model the search reads goes through here, so the flag always speaks of the newest one. The watcher starts with the first search and ends with the page.
  const read_model = (): TextModel => {
    const model = deps.build_model_();
    page_changed = false;
    (retarget_watcher ??= deps.watch_page_(() => (page_changed = true)))(model);
    return model;
  };

  const stand_on = (found: Found) => {
    shown = found;
    shown_selection = deps.selection_key_(found.model_);
  };

  // A frame or shadow host that left the page takes its text with it, and a host that gained a root has text the model lacks. Either way the model is read again.
  const is_current = (model: TextModel) => trees_alive(model) && !host_gained_root(model) && !page_changed;
  const fresh_model = (model: TextModel): TextModel => (is_current(model) ? model : read_model());

  // `as_text_` is for Enter: it searches the text fallback that a costly or timed-out pattern skipped while typing.
  async function run_update(open: Live, text: string, run: number, report: (status: string) => void, as_text = false): Promise<void> {
    const is_stale = () => live !== open || open.generation_ !== run;
    const query = compile_query(text);
    if (!query) {
      open.found = undefined;
      drop_highlights();
      return report("");
    }
    if (!is_current(open.model_)) {
      open.model_ = read_model();
      open.start = locate(open.model_, open.start_point_) ?? deps.start_index_(open.model_);
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

  const locate = (model: TextModel, point: DomPoint | undefined): number | undefined => {
    try {
      return point && model.index_of_(point.node, point.offset);
    } catch {
      return undefined;
    }
  };

  const point_of = (model: TextModel, index: number): DomPoint | undefined => {
    try {
      return model.point_at_(index);
    } catch {
      return undefined;
    }
  };

  // The index to search from for a jump: forward skips the word itself, which starts at the origin.
  const from_origin = (model: TextModel, direction: Direction): number | undefined => {
    const index = locate(model, origin);
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
    let found = kept && is_current(kept.model_) ? kept : undefined;
    let wrapped = false;
    // A step from a caret (visual mode) looks from the caret, as the search line does, and not from the last match.
    if (found && !origin) {
      const stepped = step_match(found.current, found.matches.from.length, direction);
      found = { ...found, current: stepped.index };
      wrapped = stepped.wrapped;
    } else {
      const query = found ? undefined : compile_query(previous.query);
      if (!found && !query) return { ok: false, message: "No previous search" };
      const model = found?.model_ ?? (kept ? fresh_model(kept.model_) : read_model());
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
      const carried = kept && carry_index(kept, model);
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
    // `/` or `?` was pressed. The model is read again each time, because the page may have changed since the last search.
    // `from` is where a visual session has its caret, so the search goes on from there and not from the top of the screen.
    begin(direction: Direction, from?: DomPoint): void {
      drop_highlights();
      // The old match belongs to the old search, so a search that finds nothing must not leave it as the position.
      shown = undefined;
      step_generation++;
      const model = read_model();
      origin = from;
      const start = from_origin(model, direction) ?? deps.start_index_(model);
      origin = undefined;
      live = { model_: model, direction, start, start_point_: point_of(model, start), generation_: 0, text: "", timed_out_: undefined, found: undefined, pending: Promise.resolve(), colors: deps.read_colors_(), finished: undefined };
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

    // Where the search stands in `model`, for a caret or visual session that starts at it. A later click or selection takes the position, so nothing then.
    position(model: TextModel): number | undefined {
      if (!shown) return undefined;
      const now = deps.selection_key_(shown.model_);
      if (now.length !== shown_selection.length || now.some((entry, at) => entry !== shown_selection[at])) return undefined;
      return carry_index(shown, model);
    },
  };
}
