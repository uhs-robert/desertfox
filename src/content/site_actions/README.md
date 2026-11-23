# site_actions

The `site_actions` bundle (`site_actions.js`): the handlers that site rows bind to keys, kept out of `content.js`. The content script loads it on the first press.

Behavior is in `docs/design/interfaces_hints.md`, section "Site action files for the site_actions bundle".

- `send_key.ts`: the `page.send_key` handler and its queue of key pairs.
- `arrow.ts`: the `page.arrow` handler, bound by the shipped `arrow` site mode.
- `clipboard.ts`: the `page.clipboard` handler.
- `main.ts`: registers the handlers with the host.

Rules across files:

- `page.item` is not here. It lives in the `item` bundle (`src/content/item/`), because it does not fit this bundle's size limit.
- `arrow.ts` sends through `send_key.ts`, and `src/content/editor/` copies through `clipboard.ts`.
