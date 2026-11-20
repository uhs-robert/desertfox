# tree

The `tree` bundle (`tree.js`, 4 KB limit). The content script loads it on the first press of a tree key in item mode, so the walk stays out of `content.js` and `item.js`.

- `main.ts`: registers `page.tree`. It asks the item bundle for the current item (`item.current`, through `run_command_`), reads the shown items of the row's `selector` with their depth (`depth`, from the item, an element inside it or the closest ancestor), and runs the action. A move lands through `page.item` with the `current` direction, after it scrolls the target into view and focuses it, so focus, the box and the last move match j. A fold clicks the row's `fold` control with `click_like_a_hint` (imported from `../hints/actions.ts`) and lands on the item again, because the click moves the focus onto the control. It refuses when the control is hidden, and it does not check that the click took. Runs queue, so two keys typed together do not start from the same item. Not unit tested, it needs a DOM.
- `walk.ts`: the pure moves on a list of `{ item, depth }`: `parent_of`, `child_of` and `sibling_of`. Hidden items are not in the list, so a folded item has no child and the walk skips its replies.

Tests: `test/tree_walk.test.ts` (the walk), `test/page_tree.test.ts` (the schema and the Hacker News row) and `test/key/p50_comment_trees.mjs` (the keys on a stand-in thread).
