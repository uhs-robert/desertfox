// The start of item mode on a list page, which the `item_navigator` setting asks for when a load completes.

export type StartDeps = {
  mode_: () => string;
  // The user has pressed a key or clicked in the page since it loaded.
  user_active_: () => boolean;
  in_field_: () => boolean;
  // Reads the page for a list: the items of `selector`, the item selector of the page's site row, or else the finder's list. The finder keeps its answer, so a later press does not read again.
  has_list_: (selector: string | undefined) => boolean;
  enter_: () => void;
  when_idle_: (run: () => void) => void;
};

// The ask is spent at once: a page where the user left item mode, or one that had no list, never starts again, however often the background asks. The checks run when the page is idle, after any key the user pressed meanwhile, so the user's first key wins: a page that took a key or a click, a field that holds the focus and a mode other than normal all mean the user got there first.
export function create_item_start(deps: StartDeps): (selector?: string) => void {
  let asked = false;
  return (selector) => {
    if (asked) return;
    asked = true;
    deps.when_idle_(() => {
      if (deps.mode_() !== "normal" || deps.user_active_() || deps.in_field_() || !deps.has_list_(selector)) return;
      deps.enter_();
    });
  };
}
