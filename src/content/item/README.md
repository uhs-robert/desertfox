# item

The `item` bundle (`item.js`): the handler of `page.item` and visual item mode, with the item finder. The content script loads it on the first item key.

Behavior is in `docs/design/bundles.md`, section "Item files for the item bundle".

- `main.ts`: registers `page.item`, `item.start`, `item.mark`, `item.lists`, `item.current`, `item.range` and `item.cursor` with the host.
- `pick.ts`: the pure picks (`step_from`, `pick_item`, `pick_section`, `place_of`) and the `move_item` handler. Open it for how a move chooses its item.
- `ends.ts`: `first` and `last` of `page.item`: `list_scroller` and `follow_end`, which land on the end item while the page loads more.
- `overlay.ts`: the box around the item and the range marks of visual item mode, in a closed shadow root.
- `selection.ts`: the range of visual item mode: anchor and cursor ends kept by item key, never by node.
- `hover.ts`: `hover_at` and `thumbnail`: the mouse events of a pointer resting on the item's thumbnail, and the unhover.
- `lists.ts`: the `I` picker's lists (`lists_with_row`, `pick_list`) and `args_for_pin`, which drops the row selectors while a pin is on.
- `start.ts`: `create_item_start`, the start of item mode that the `item_navigator` setting asks for.
- `finder.ts`: the item finder, a pure read of the page through a `PageReader`: the lists and grids.
- `aria_lists.ts`: `find_aria_lists`, the finder's pass for `listbox`, `grid`, `feed` and `tree` widgets.
- `menus.ts`: `find_menus`, the finder's pass for `nav` and `aside` menus.
- `derived.ts`: the derived row: the finder's answer kept per document, the active region and the re-read rules.

Rules across files:

- `finder.ts`, `aria_lists.ts` and `menus.ts` read the page only through `PageReader` (`src/content/lib/page_reader.ts`), so tests pass fakes.
- The repeated blocks (`src/content/lib/groups.ts`) and the real-element reader (`src/content/lib/dom_reader.ts`) live in `lib`, shared with `next_page`.
- The shared item types are in `src/content/lib/item_types.ts`.
- Tests: `test/item_selection.test.ts`, `test/item_derived.test.ts`, `test/item_hover.test.ts`, `test/item_ends.test.ts`, `test/item_aria_lists.test.ts`, `test/site_item.test.ts`.
- Finder precision on saved pages: `test/next_page/item_marks.test.ts`.
- Key tests: `test/key/p44_item_rows.mjs`, `test/key/p45_focus_mark.mjs`, `test/key/p49_item_finder.mjs`, `test/key/p49_item_aria.mjs` and `test/key/p49_item_visual.mjs`.
