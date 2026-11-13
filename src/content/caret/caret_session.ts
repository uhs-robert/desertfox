// The one caret or visual session of this page. Only the sink's `enter` starts one, and the sink's `exit` ends it.
// A generation counts each session start and each start of a visual run, so work that awaits (a copy, a search step, the search line) acts only on the run that started it.

import type { BundleHostApi, ExitDestination } from "../bundle_host.ts";
import type { PageText } from "./page_text.ts";
import { is_visual } from "./selection_state.ts";
import type { CaretMode, Cursor, Span } from "./selection_state.ts";
import type { TextModel } from "./text_model.ts";

// `span_` is the text the last paint drew, which `y`, `p`, `*` and `#` act on.
export type Session = { model_: TextModel; cursor: Cursor; mode: CaretMode; goal_x_: number | undefined; span_: Span; generation_: number };

export type SessionDeps = {
  host: Pick<BundleHostApi, "get_mode" | "set_mode_">;
  page_text: Pick<PageText, "current" | "is_current" | "carry">;
  // Where a new session starts, or why none can.
  start_: (mode: CaretMode) => { model_: TextModel; cursor: Cursor } | string;
  // An outside change to the page selection since the last paint: a drag as a cursor, a click as its index.
  foreign_move_: (open: Session) => Cursor | number | undefined;
  first_visible_: (model: TextModel) => number;
  // Draws the session and sets its `span_`.
  paint_: (open: Session) => void;
  set_mode_colors_: (mode: CaretMode) => void;
  // Clears what the session drew.
  ended_: () => void;
};

export const SESSION_MODES: readonly ExitDestination[] = ["caret", "visual", "visual_line"];

export function create_sessions({ host, page_text, start_, foreign_move_, first_visible_, paint_, set_mode_colors_, ended_ }: SessionDeps) {
  let session: Session | undefined;
  let generation = 0;
  // The generation of the session a `/` or `?` started from. The command line takes the mode while it is open, and the session waits for the end of the search.
  let searching_from: number | undefined;

  const is_run = (run: number | undefined) => run !== undefined && session?.generation_ === run;

  const end = () => {
    session = undefined;
    ended_();
  };

  // An outside move first, with the model it was made on: the rebuild can drop the node it ends in. A click collapses the cursor there.
  function catch_up(open: Session): Session | undefined {
    const moved = foreign_move_(open);
    if (moved !== undefined) Object.assign(open, { cursor: typeof moved === "number" ? { anchor: moved, caret: moved } : moved, goal_x_: undefined });
    return read_again(open);
  }

  // The page changed its text since the session read it, so the session reads it again. The caret keeps its character if that is still on the page. Undefined when the page lost all its text.
  // The page selection stays as painted until the next paint: the search reads it to tell its match from a later click.
  function read_again(open: Session): Session | undefined {
    if (page_text.is_current(open.model_)) return open;
    const model = page_text.current();
    if (model.text === "") return undefined;
    const carry = (index: number) => page_text.carry(open.model_, index, model);
    const caret = carry(open.cursor.caret) ?? first_visible_(model);
    const anchor = is_visual(open.mode) ? (carry(open.cursor.anchor) ?? caret) : caret;
    return Object.assign(open, { model_: model, cursor: { anchor, caret }, goal_x_: undefined });
  }

  // A string is the failure message. The mode went back to normal then.
  function ensure(mode: CaretMode): Session | string {
    const mode_changed = session?.mode !== mode;
    let open = session && catch_up(session);
    if (!open) {
      const started = start_(mode);
      if (typeof started === "string") {
        host.set_mode_("normal");
        return started;
      }
      open = { ...started, mode, goal_x_: undefined, generation_: ++generation } as Session;
    }
    session = open;
    // Caret mode shows one character, so leaving visual mode drops the anchor.
    if (mode === "caret") open.cursor = { anchor: open.cursor.caret, caret: open.cursor.caret };
    if (mode_changed && is_visual(mode)) open.generation_ = ++generation;
    open.mode = mode;
    paint_(open);
    if (mode_changed) set_mode_colors_(mode);
    return open;
  }

  // A click in a visual mode ends it, as in vim, and caret mode takes the click. The sink asks before the keymap reads the key, so the key runs in caret mode.
  const take_click_ = (): boolean => !!session && is_visual(session.mode) && typeof foreign_move_(session) === "number" && (host.set_mode_("caret"), true);

  // The open session caught up with the page and painted, undefined outside one. A string is why the session ended, on a page that lost all its text.
  const current = (): Session | string | undefined => session && (take_click_() ? session : ensure(session.mode));

  return {
    // The session as it is, with no catch-up.
    open_: () => session,
    enter_: (mode: CaretMode): string | undefined => {
      const started = ensure(mode);
      if (typeof started === "string") return started;
    },
    // Between caret and the visual modes the session stays, and so does it for the search line it opened. Every other way out ends it.
    exit_(destination: ExitDestination): void {
      const is_search_line = destination === "cmdline" && is_run(searching_from);
      if (!SESSION_MODES.includes(destination) && !is_search_line) end();
    },
    take_click_,
    current_: current,
    read_again_: read_again,
    // A command that needs a session from outside one enters `mode` first, so the sink makes the session and the badge shows it. Caret mode takes any session mode, visual mode only itself.
    require_(mode: CaretMode): Session | string | undefined {
      const held = host.get_mode();
      if (mode === "caret" ? !SESSION_MODES.includes(held) : held !== mode) host.set_mode_(mode);
      return current();
    },
    is_run_: is_run,
    hold_for_search_(): void {
      searching_from = session?.generation_;
    },
    // The search line closed. The held session takes the match, and paints, before its mode comes back: entering the mode adopts any page selection that differs from the last paint.
    release_search_(follow: (open: Session) => void): void {
      const from = searching_from;
      searching_from = undefined;
      if (!is_run(from)) return;
      follow(session!);
      if (is_run(from)) host.set_mode_(session!.mode);
    },
    // No caret can show on a page that lost all its text, so the session ends, as an entry on such a page does.
    end_empty_(): void {
      end();
      if (SESSION_MODES.includes(host.get_mode())) host.set_mode_("normal");
    },
  };
}

export type Sessions = ReturnType<typeof create_sessions>;
