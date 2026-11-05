// The life of a character find (`f`, `t`, `F`, `T`) that shows its matches and repeats on the same key family. It starts when a target is typed and ends exactly once.
// The sink sees every key before the keymap, but only the keymap knows which key is a find key. So a key ends the find in a microtask, unless the `caret.move` handler for a find key runs first in the same key press.

export type FindModeDeps = {
  show: () => void;
  hide: () => void;
  // Calls `on_change` when the view scrolls or resizes. The returned function stops it.
  watch_view: (on_change: () => void) => () => void;
  defer: (task: () => void) => void;
};

type Live = { till: boolean; stop_watching: () => void; key: number; key_was_find: boolean; counting: boolean };

const ESCAPES = ["<Escape>", "<C-[>"];

export function create_find_mode(deps: FindModeDeps) {
  let live: Live | undefined;

  const end = () => {
    if (!live) return;
    const ended = live;
    live = undefined;
    ended.stop_watching();
    deps.hide();
  };

  return {
    is_live: () => live !== undefined,
    is_till: () => live?.till,
    end,
    // A target was typed. A find already live keeps its listener and takes the new kind.
    start: (till: boolean) => {
      if (live) live.till = till;
      else live = { till, stop_watching: deps.watch_view(() => deps.show()), key: 0, key_was_find: false, counting: false };
      deps.show();
    },
    refresh: () => live && deps.show(),
    // The `caret.move` handler calls this for a find key, `f`, `t`, `F`, `T`, `;` or `,`, before anything else.
    note_find_key: () => {
      if (!live) return;
      live.key_was_find = true;
      live.counting = false;
    },
    // The sink calls this for every key while the find is live. Escape ends it and is spent. A count digit keeps it. Any other key ends it unless a find key claims it first.
    on_token: (token: string): "handled" | "pass" => {
      const open = live;
      if (!open) return "pass";
      if (ESCAPES.includes(token)) {
        end();
        return "handled";
      }
      if (/^[1-9]$/.test(token) || (open.counting && token === "0")) {
        open.counting = true;
        return "pass";
      }
      open.counting = false;
      const key = ++open.key;
      open.key_was_find = false;
      deps.defer(() => {
        if (live === open && open.key === key && !open.key_was_find) end();
      });
      return "pass";
    },
  };
}

export type FindMode = ReturnType<typeof create_find_mode>;
