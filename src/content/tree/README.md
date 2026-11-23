# tree

The `tree` bundle (`tree.js`): moves and folds through nested items such as comments. The content script loads it on the first tree key in item mode.

Behavior is in `docs/design/bundles.md`, section "Tree files for the tree bundle".

- `main.ts`: registers `page.tree`: reads the shown items with their depth and runs the move or fold.
- `walk.ts`: the pure moves on a list of `{ item, depth }`: `parent_of`, `child_of` and `sibling_of`.

Rules across files:

- `main.ts` asks the item bundle for the current item and lands a move through `page.item`.
- Tests: `test/tree_walk.test.ts`, `test/page_tree.test.ts`, `test/key/p50_comment_trees.mjs` and `test/key/p52_aria_trees.mjs`.
