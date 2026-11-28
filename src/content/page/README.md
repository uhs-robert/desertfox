# page

The `page` bundle (`page.js`): the rare page commands (`scroll.align`, `copy.url`, `page.focus_input`, the mark and jump commands) and the selection answer.

Behavior is in `docs/design/bundles.md`, section "Page files for the page bundle".

- `main.ts`: registers the handlers and the `get_selection` listener. The mark and jump code sits here.
- `selection.ts`: the selected text of the frame, from the focused text field first.
- `align.ts`: the code of `scroll.align`.
- `copy.ts`: the code of `copy.url`.
- `focus_input.ts`: the code of `page.focus_input`.
- `once_return.ts`: takes the frame back to the mode a one-shot normal command (`mode.normal_once`) came from, once a mode that command opened ends.

Rules across files:

- The background injects the bundle on the first run of one of its commands. Its state comes from the host, since this bundle has no copy of the content script's state.
- `main.ts` reads the scroll box through the host (`scroll_box_`) and talks to the background mark store.
