// The start of item mode on a list page, which the `item_navigator` setting asks for when a load completes. A resumed page (a link followed in item mode) joined the mode during its load, so for it the start only checks for a list.

export type StartDeps = {
  mode_: () => string;
  // The user has pressed a key or clicked in the page since it loaded.
  user_active_: () => boolean;
  in_field_: () => boolean;
  // Reads the page for a list: the items of `selectors`, the item selectors of the page's site rows, or with none the finder's list. The finder keeps its answer, so a later press does not read again.
  has_list_: (selectors: readonly string[]) => boolean;
  enter_: () => void;
  leave_: () => void;
  when_idle_: (run: () => void) => void;
  later_: (run: () => void, ms: number) => void;
  now_: () => number;
  // Adds or removes the listener for the page starting to unload. It is on only during the wait, since an unload listener can keep a page out of the back-forward cache.
  on_unload_: (run: () => void, on: boolean) => void;
};

// A site row names its items, and a site such as Drive draws them well after the load completes, so the start looks again for this long.
export const ROW_ITEMS_WAIT_MS = 5000;
const ROW_ITEMS_LOOK_EVERY_MS = 250;

// A leave that the user or the browser cancels fires `beforeunload` too, and the page stays. The flag clears this long after the event, and a real unload ends the page and its timer first.
export const UNLOAD_SETTLE_MS = 1500;

// A resumed page joined item mode at its first keymap read (`tab_item.ts`), so keys pressed during its load ran in the mode and do not stop it. Its start only drops it to normal when it has no list. A resumed page in normal mode either left the mode or read its keymap before the load committed, and takes the usual start.
// The ask is spent at once: a page where the user left item mode, or one that had no list, never starts again, however often the background asks. The checks run when the page is idle, after any key the user pressed meanwhile, so the user's first key wins: a page that took a key or a click, a field that holds the focus and a mode other than normal all mean the user got there first, and end the wait for a row's items too. The one exception is a leave that came to nothing: the wait parks while the page may be leaving, and starts again when the page stays.
export function create_item_start(deps: StartDeps): (selectors?: readonly string[], resume?: boolean) => void {
  let asked = false;
  return (selectors = [], resume = false) => {
    if (asked) return;
    asked = true;
    const user_got_there_first = () => deps.mode_() !== "normal" || deps.user_active_() || deps.in_field_();
    // A late timer must not stretch the wait, so it ends by the clock, counted from the ask, or from the restart after a cancelled leave.
    let deadline = deps.now_() + ROW_ITEMS_WAIT_MS;
    // A page that navigates on its own during the wait stays live while the next page loads, and must not enter then.
    let unloading = false;
    // The look saw the flag and stopped, so only the settle timer can start it again. Without it the settle timer has nothing to restart.
    let parked = false;
    // Only the latest leave's timer clears the flag, so an earlier timer does not cut a later leave short.
    let leaves = 0;
    const settle = (leave: number) => {
      if (leave !== leaves) return;
      unloading = false;
      if (!parked) return;
      parked = false;
      deadline = deps.now_() + ROW_ITEMS_WAIT_MS;
      deps.on_unload_(unload, true);
      deps.when_idle_(look);
    };
    const unload = () => {
      unloading = true;
      const leave = ++leaves;
      deps.later_(() => settle(leave), UNLOAD_SETTLE_MS);
    };
    // Each look reads the gate again right before it enters, so a mode the user picked during the wait stands.
    function look() {
      if (unloading) {
        parked = true;
        return deps.on_unload_(unload, false);
      }
      const joined_at_load = resume && deps.mode_() === "item";
      if (joined_at_load || (!user_got_there_first() && deps.now_() <= deadline)) {
        if (deps.has_list_(selectors)) {
          if (!joined_at_load) deps.enter_();
        } else if (selectors[0] && deps.now_() <= deadline) return deps.later_(look, ROW_ITEMS_LOOK_EVERY_MS);
        else if (joined_at_load) deps.leave_();
      }
      deps.on_unload_(unload, false);
    }
    deps.on_unload_(unload, true);
    deps.when_idle_(look);
  };
}
