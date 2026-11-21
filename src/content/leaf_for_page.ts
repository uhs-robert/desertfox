// Which leaf a guarded key runs on this page. Shared by run_leaf.ts and the which-key bundle, which cannot import run_leaf.ts (it pulls in run_content).

import type { TreeLeaf } from "../shared/index.ts";
import { is_shown } from "./shown.ts";

// A selector that does not parse matches nothing, so the key falls through.
const matches_safely = (read: () => boolean): boolean => {
  try {
    return read();
  } catch {
    return false;
  }
};

// The leaf a key runs under a site row bind's guards: the first leaf of the `otherwise` chain whose guards hold, which is a choice of a choice list or the leaf the bind replaced, or nothing when none holds. Focus on an element inside a `when_focus` match counts, such as a control inside a map. Body counts as no focus, so a bind aimed at the page's main widget also runs before the user has focused it.
export const leaf_for_page = (leaf: TreeLeaf, focused: Element | null, body: Element | null, root: ParentNode): TreeLeaf | undefined =>
  (!leaf.when_focus || !focused || focused === body || matches_safely(() => !!focused.closest(leaf.when_focus!))) && (!leaf.when_present || matches_safely(() => Array.from(root.querySelectorAll(leaf.when_present!)).some(is_shown)))
    ? leaf
    : leaf.otherwise && leaf_for_page(leaf.otherwise, focused, body, root);
