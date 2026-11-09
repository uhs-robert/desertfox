// The life of a character find (`f`, `t`, `F`, `T`) that shows its matches and repeats on the same key family. It starts when a target is typed and ends exactly once.
// The sink sees every key before the keymap, but only the keymap knows which key is a find key. So a key ends the find in a microtask, unless the `caret.move` handler for a find key runs first in the same key press.

// What a repaint needs. `current` is a text position valid only in the model that `current_owner_` names, and the colors are the ones read when this find began.
export type FindView<Colors> = { colors: Colors | undefined; current: number | undefined; current_owner_: unknown };

export type FindModeDeps<Colors> = {
  show: (view: FindView<Colors>) => void;
  // Read for every new find, so a palette changed by `:set` shows on the next one.
  read_colors_: () => Promise<Colors>;
  hide: () => void;
  // Calls `on_change` when the view scrolls or resizes. The returned function stops it.
  watch_view_: (on_change: () => void) => () => void;
  defer: (task: () => void) => void;
};

type Live<Colors> = { till: boolean; stop_watching_: () => void; key: number; key_was_find_: boolean; counting_: boolean; view: FindView<Colors> };

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
    is_till: () => live?.till,
    end,
    // A target was typed, so this is a new find: no current match yet, and fresh colors. A find already live keeps its listener. Nothing is drawn until `refresh`, after the caret moved.
    start: (till: boolean) => {
      const view: FindView<Colors> = { colors: live?.view.colors, current: undefined, current_owner_: undefined };
      if (live) Object.assign(live, { till, view });
      else live = { till, stop_watching_: deps.watch_view_(show), key: 0, key_was_find_: false, counting_: false, view };
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
    // The `caret.move` handler calls this for a find key, `f`, `t`, `F`, `T`, `;` or `,`, before anything else.
    note_find_key_: () => {
      if (!live) return;
      live.key_was_find_ = true;
      live.counting_ = false;
    },
    // The sink calls this for every key while the find is live. Escape ends it and is spent. A count digit keeps it. Any other key ends it unless a find key claims it first.
    on_token_: (token: string): "handled" | "pass" => {
      const open = live;
      if (!open) return "pass";
      if (is_escape(token)) {
        end();
        return "handled";
      }
      if (/^[1-9]$/.test(token) || (open.counting_ && token === "0")) {
        open.counting_ = true;
        return "pass";
      }
      open.counting_ = false;
      const key = ++open.key;
      open.key_was_find_ = false;
      deps.defer(() => {
        if (live === open && open.key === key && !open.key_was_find_) end();
      });
      return "pass";
    },
  };
}

export type FindMode<Colors> = ReturnType<typeof create_find_mode<Colors>>;
