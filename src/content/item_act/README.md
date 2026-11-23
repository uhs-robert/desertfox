# item_act

The `item_act` bundle (`item_act.js`): the item mode actions, kept out of `content.js`, `item.js` and `hints.js`.

Behavior is in `docs/design/bundles.md`, section "Item action files for the item_act bundle".

- `main.ts`: registers `page.item_action` (`toggle`, `open`, `toggle_range`) and `page.item_focus`.
- `focus.ts`: the focus ring behind `page.item_focus`.
- `checkbox.ts`: `checkbox_in`, which finds the checkbox of an item.

Rules across files:

- The content script loads the bundle on the first Space, Enter or Tab of item mode.
- It asks the item bundle for the current item and range (`item.current`, `item.range`). It clicks with `click_like_a_hint` (`src/content/hints/actions.ts`).
- Tests: `test/item_act.test.ts` (fakes) and `test/key/p49_item_actions.mjs` (a real window).
