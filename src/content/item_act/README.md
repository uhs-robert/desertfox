# item_act

The `item_act` bundle (`item_act.js`, 3 KB limit). The content script loads it on the first Space or Enter of item mode, so the item actions stay out of `content.js`, `item.js` and `hints.js`.

- `main.ts`: registers `page.item_action`. It asks the item bundle for the current item and its link (`item.current`, through `run_command_`), then clicks with the hint click (`click_like_a_hint` from `../hints/actions.ts`, the full pointer and mouse sequence, so most custom checkboxes react). `toggle` clicks the checkbox, `open` clicks the link. It refuses with "No current item", "No checkbox in this item" or "This item has no link". The open click does not arm the jump list's leave watch, which would put 850 bytes over the limit. Not unit tested, it needs a DOM.
- `checkbox.ts`: `checkbox_in(item, target)` finds the checkbox: the shown match of the `target` selector a site row names, else the first shown native checkbox, else the first shown element with role=checkbox. A box that a site hides behind its own drawing needs a `target`. There is no check that the click took, and no range selection.

Tests: `test/item_act.test.ts` (the checkbox search on fakes) and `test/key/p49_item_actions.mjs` (Space and Enter in a real window).
