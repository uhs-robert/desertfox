# handlers

The content-side code of each command that runs in the page: one `ContentHandler` object per command. Behavior is in `docs/design/keys.md`, section "Handlers files for content commands".

- `types.ts`: the `ContentHandler` type.
- `scroll.ts`: the `scroll.*` commands, and `scroll_target` and `end_flight` for the bundle host.
- `page.ts`: `page.blur`, and the hand-off of a hidden input frame to the parent.
- `mode.ts`: the `mode.*` commands.
- `stop.ts`: `page.stop`.
- `focus.ts`: a helper that has no handler object. `src/content/main.ts` imports it directly.

Rules across files:

- `../handler_map.ts` maps a command id to its handler. It is the only id-to-code link in the content bundle.
- `../run_content.ts` looks the id up and runs it. The background compiler checks the args and sets the count rule.
- The count rule lives in the command definition in `src/commands`, not on the handler.
- To add a handler: write it here, add it to `handler_map.ts` and define the command in `src/commands` with its count rule.
