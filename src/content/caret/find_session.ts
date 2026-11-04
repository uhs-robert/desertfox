// Page search: the live search while the line is open, the match that stays after Enter, and n and N.
// The line (the cmdline bundle) reaches it through `begin`, `update` and `end`. The keys reach it through `step`.

import { FIND_LAST_STORAGE_KEY } from "../../background/storage_keys.ts";
import type { BundleHostApi } from "../bundle_host.ts";
import { collect_matches, compile_query, describe_match, nearest_match, opposite, step_match } from "./find_match.ts";
import type { Direction, Matches, Slicing } from "./find_match.ts";
import { create_painter } from "./find_paint.ts";
import type { FindColors } from "./find_paint.ts";
import { scroll_to_index } from "./screen_line.ts";
import { stored_mode_colors } from "./selection_colors.ts";
import { first_visible_index } from "./start_point.ts";
import { build_text_model, trees_alive } from "./text_model.ts";
import type { TextModel } from "./text_model.ts";

// What the engine needs of the host script. A bundle reaches it through `window.oasisfox_host`.
type Host = Pick<BundleHostApi, "show_toast">;

type Found = { model: TextModel; query: string; invalid: boolean; direction: Direction; matches: Matches; current: number };
type Last = { query: string; direction: Direction };

// While the line is open. `start` is where the search began, so each keystroke looks from the same place.
type Live = {
  model: TextModel;
  direction: Direction;
  start: number;
  // Bumped by each keystroke and by the end of the search. A scan or paint that finds it changed drops its work.
  generation: number;
  found: Found | undefined;
  pending: Promise<void>;
  colors: Promise<FindColors>;
  // Each scroll position before the search first moved it, for Escape.
  scrolled: Map<Element | Window, [number, number]>;
  ending: boolean;
};

const SLICE_MS = 8;
// The command line covers about this much of the bottom edge while it is open.
const LINE_HEIGHT_PX = 56;
const FALLBACK_COLORS: FindColors = {
  all: { dark: ["#ffba75", "#0c0e13"], light: ["#85460e", "#e8e5d8"] },
  current: { dark: ["#7fcf78", "#0c0e13"], light: ["#356731", "#e8e5d8"] },
};

const painter = create_painter();
let live: Live | undefined;
// The search whose highlights are on the page after Enter. Rebuilt by `step` when the page it read has changed.
let shown: Found | undefined;
let last: Last | undefined;
// Bumped by each `step` that has to scan again, so an older scan does not paint over a newer one.
let step_generation = 0;

const read_colors = async (): Promise<FindColors> => {
  const [all, current] = await Promise.all([stored_mode_colors("visual"), stored_mode_colors("caret")]);
  return all && current ? { all, current } : FALLBACK_COLORS;
};

const yield_to_page = () => new Promise<void>((resume) => setTimeout(resume, 0));
const slicing = (is_stale: () => boolean): Slicing => ({ is_stale, yield_to_page, now: () => performance.now(), slice_ms: SLICE_MS });

// A private window leaves nothing behind, so its last search lives in memory only.
async function remember(next: Last): Promise<void> {
  last = next;
  if (browser.extension.inIncognitoContext) return;
  await browser.storage.local.set({ [FIND_LAST_STORAGE_KEY]: next });
}

async function recall(): Promise<Last | undefined> {
  if (last) return last;
  const stored = (await browser.storage.local.get(FIND_LAST_STORAGE_KEY))[FIND_LAST_STORAGE_KEY] as Last | undefined;
  return (last = stored && typeof stored.query === "string" && (stored.direction === "forward" || stored.direction === "backward") ? stored : undefined);
}

// Where the current match of `old` sits in a rebuilt model. Undefined when its text has left the page: a node of a removed frame throws on any read.
function carry_index(old: Found, model: TextModel): number | undefined {
  try {
    const { node, offset } = old.model.point_at(old.matches.from[old.current]!);
    return model.index_of(node, offset);
  } catch {
    return undefined;
  }
}

export function create_find(host: Host) {
  const scroll_to = (found: Found, scrolled?: Live["scrolled"]) => {
    try {
      scroll_to_index(found.model, found.matches.from[found.current]!, {
        bottom_inset: scrolled ? LINE_HEIGHT_PX : 0,
        before_scroll: (view) => scrolled && !scrolled.has(view) && scrolled.set(view, "scrollX" in view ? [view.scrollX, view.scrollY] : [view.scrollLeft, view.scrollTop]),
      });
    } catch {}
  };

  const restore_scroll = (scrolled: Live["scrolled"]) => {
    for (const [view, [x, y]] of scrolled) {
      try {
        view.scrollTo(x, y);
      } catch {}
    }
    scrolled.clear();
  };

  // A frame or shadow host that left the page takes its text with it, so the model is read again.
  const fresh_model = (model: TextModel): TextModel => (trees_alive(model) ? model : build_text_model(document.body));

  async function run_update(open: Live, text: string, run: number, report: (status: string) => void): Promise<void> {
    const is_stale = () => live !== open || open.generation !== run;
    const query = compile_query(text);
    if (!query) {
      open.found = undefined;
      painter.clear();
      restore_scroll(open.scrolled);
      return report("");
    }
    if (!trees_alive(open.model)) {
      open.model = build_text_model(document.body);
      open.start = first_visible_index(open.model);
    }
    const matches = await collect_matches(open.model.text, query.regex, slicing(is_stale));
    if (!matches || is_stale()) return;
    const colors = await open.colors;
    if (is_stale()) return;
    // The page can lose a frame while the scan runs. Then the match positions no longer fit the text, so the scan starts over.
    if (!trees_alive(open.model)) return run_update(open, text, run, report);
    const first = nearest_match(matches.from, open.start, open.direction);
    if (!first) {
      open.found = undefined;
      painter.clear();
      restore_scroll(open.scrolled);
      return report(describe_match(text, 0, 0, query.invalid));
    }
    const found: Found = { model: open.model, query: text, invalid: query.invalid, direction: open.direction, matches, current: first.index };
    open.found = found;
    painter.paint(found.model, matches, first.index, colors);
    scroll_to(found, open.scrolled);
    report(describe_match(text, matches.from.length, first.index, query.invalid, first.wrapped));
  }

  return {
    // `/` or `?` was pressed. The model is read again each time, because the page may have changed since the last search.
    begin(direction: Direction): void {
      painter.clear();
      shown = undefined;
      step_generation++;
      const model = build_text_model(document.body);
      live = { model, direction, start: model.text === "" ? 0 : first_visible_index(model), generation: 0, found: undefined, pending: Promise.resolve(), colors: read_colors(), scrolled: new Map(), ending: false };
    },

    // The text of the line changed. `report` gets the line to show under it.
    update(text: string, report: (status: string) => void): void {
      const open = live;
      if (!open || open.ending) return;
      const run = ++open.generation;
      open.pending = run_update(open, text, run, report).catch((error) => host.show_toast(`Search failed: ${(error as Error).message}`));
    },

    // The line closed. `keep` is Enter: the match stays and `n` and `N` pick up from it. Otherwise the page goes back as it was.
    async end(keep: boolean): Promise<void> {
      const open = live;
      if (!open) return;
      if (!keep) {
        // Dropping `live` first means a scan or paint still on its way sees a stale search and stops.
        live = undefined;
        open.generation++;
        painter.clear();
        restore_scroll(open.scrolled);
        return;
      }
      open.ending = true;
      await open.pending;
      live = undefined;
      if (!open.found) {
        painter.clear();
        restore_scroll(open.scrolled);
        return;
      }
      shown = open.found;
      await remember({ query: open.found.query, direction: open.direction });
    },

    // `n` repeats the last search in its direction and `N` goes the other way.
    async step(reverse: boolean): Promise<void> {
      if (live) return;
      const run = ++step_generation;
      const previous = await recall();
      if (run !== step_generation) return;
      if (!previous) return host.show_toast("No previous search");
      const direction = reverse ? opposite(previous.direction) : previous.direction;
      const colors = await read_colors();
      const kept = shown?.query === previous.query ? shown : undefined;
      let found = kept && trees_alive(kept.model) ? kept : undefined;
      let wrapped = false;
      if (found) {
        const stepped = step_match(found.current, found.matches.from.length, direction);
        found = { ...found, current: stepped.index };
        wrapped = stepped.wrapped;
      } else {
        const query = compile_query(previous.query);
        if (!query) return;
        const model = kept ? fresh_model(kept.model) : build_text_model(document.body);
        const matches = await collect_matches(model.text, query.regex, slicing(() => run !== step_generation));
        if (!matches || run !== step_generation) return;
        // After a rebuild the step goes on from the match the user was on, when its text is still on the page.
        const carried = kept && carry_index(kept, model);
        const start = carried === undefined ? first_visible_index(model) : direction === "forward" ? carried + 1 : carried;
        const first = nearest_match(matches.from, start, direction);
        if (!first) return host.show_toast(describe_match(previous.query, 0, 0, query.invalid));
        found = { model, query: previous.query, invalid: query.invalid, direction: previous.direction, matches, current: first.index };
        wrapped = first.wrapped;
      }
      shown = found;
      painter.paint(found.model, found.matches, found.current, colors);
      scroll_to(found);
      host.show_toast(describe_match(found.query, found.matches.from.length, found.current, found.invalid, wrapped));
    },
  };
}
