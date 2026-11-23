# next_page

The `next_page` bundle (`next_page.js`): the `page.follow` handler of `]]` and `[[`. The content script loads it on the first press.

Behavior is in `docs/design/bundles.md`, section "Next page files for the next_page bundle".

- `detect.ts`: the pure detector. It reads the page through a `PageReader` and answers `follow`, `click`, `scroll` or `none`. Open it to change how the next link is chosen.
- `load_more.ts`: the load step. It finds the main list and the control below it, or answers `scroll`. Open it for load-more buttons.
- `follow_links.ts`: the live side. `find_next_page` gathers the candidates from the page and runs the detector on real elements.
- `load_outcome.ts`: `wait_for_new_content` and `create_load_step`, which runs one load at a time per document.
- `item_after_load.ts`: moves the `page.item` box to the first new item after a load.
- `main.ts`: the handler. It reads the patterns from config and turns the detector's answer into a follow, click or scroll.

Rules across files:

- This bundle borrows the collect walk, the presence test and the click from `../lib/`, and does not load the hints bundle.
- `detect.ts` touches the page only through `PageReader`. Tests feed it saved pages through `PageReader` (`test/fixtures/next_page/`).
- `item_after_load.ts` reaches the item bundle only through its `item.cursor` handler.
