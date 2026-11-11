# site_actions

The `site_actions` bundle (`site_actions.js`, 4 KB limit). The content script loads it on the first press of a command that site rows bind to keys, so these handlers stay out of `content.js`.

- `send_key.ts`: the `page.send_key` handler. It sends a `keydown` and a `keyup` with a key name and a legacy key code to the element the selector finds, or to the focused element. It refuses when the selector matches nothing. The events are untrusted, so the content script ignores them and the key does not loop. The document and the event maker are parameters, so a test passes fakes. Pure.
- `main.ts`: registers the handler with the host. Not unit tested, it needs a DOM.
