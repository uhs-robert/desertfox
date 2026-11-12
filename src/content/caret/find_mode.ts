// The life of a character find (`f`, `t`, `F`, `T`) that shows its matches. It starts when `caret.find` runs and ends exactly once: on Escape, on a caret command that is not a find, or on leaving the mode.
// A key never ends it by itself. The target key reaches `caret.find` through the background, after the sink saw it, so no rule can tell a find key from another in the key press.

// What a repaint needs. `current` is a text position valid only in the model that `current_owner_` names, and the colors are the ones read when this find began.
export type FindView<Colors> = { colors: Colors | undefined; current: number | undefined; current_owner_: unknown };

export type FindModeDeps<Colors> = {
  show: (view: FindView<Colors>) => void;
  // Read for every new find, so a palette changed by `:set` shows on the next one.
  read_colors_: () => Promise<Colors>;
  hide: () => void;
  // Calls `on_change` when the view scrolls or resizes. The returned function stops it.
  watch_view_: (on_change: () => void) => () => void;
};

type Live<Colors> = { stop_watching_: () => void; view: FindView<Colors> };

export const is_escape = (token: string): boolean => token === "<Escape>" || token === "<C-[>";

export function create_find_mode<Colors>(deps: FindModeDeps<Colors>) {
  let live: Live<Colors> | undefined;
  const show = () => live && deps.show(live.view);

  const end = () => {
    if (!live) return;
    const ended = live;
    live = undefined;
    ended.stop_watching_();
    deps.hide();
  };

  return {
    is_live_: () => live !== undefined,
    end,
    // A target was typed, so this is a new find: no current match yet, and fresh colors. A find already live keeps its listener. Nothing is drawn until `refresh`, after the caret moved.
    start: () => {
      const view: FindView<Colors> = { colors: live?.view.colors, current: undefined, current_owner_: undefined };
      if (live) live.view = view;
      else live = { stop_watching_: deps.watch_view_(show), view };
      const open = live;
      void deps.read_colors_().then((colors) => {
        if (live !== open) return;
        open.view.colors = colors;
        show();
      });
    },
    set_current_: (at: number, owner: unknown) => {
      if (live) Object.assign(live.view, { current: at, current_owner_: owner });
    },
    refresh: show,
    // The sink calls this for every key while the find is live. Escape ends it and is spent.
    on_token_: (token: string): "handled" | "pass" => {
      if (!live || !is_escape(token)) return "pass";
      end();
      return "handled";
    },
  };
}

export type FindMode<Colors> = ReturnType<typeof create_find_mode<Colors>>;
