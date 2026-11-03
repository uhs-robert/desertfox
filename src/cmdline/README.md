# cmdline

The command line: press `:` and a bar opens at the bottom. Type a command, press Enter, it runs.

- `host.ts`: the `cmdline` bundle (`cmdline.js`). The first `:` injects it into the page. It mounts the iframe in a closed shadow root, sets the `cmdline` mode, keeps the keys typed before the page is ready, and sends the parsed command to the background as a `run` message from the page's own frame. It closes itself if the page does not say ready in 3 s.
- `page.ts`, `cmdline.html`: the page in the iframe (`cmdline_page.js`). It reads the stored keymap and runs its own matcher on the `cmdline` mode, because the content script's keys cannot reach into the iframe. Enter parses the line with `parse_command_line`, read from `commands.json` through `word_lookup.ts`, because the registry cannot load in a page.
- `session.ts`: the text, the inline message and the history walk, apart from the DOM. A parse error keeps the line open and shows the error. Pure.
- `key_input.ts`: one key token to an effect, or to text when no key is bound. Pure.
- `history_cursor.ts`: Up and Down over the history with the draft kept. Pure.
- `protocol.ts`: the `postMessage` shapes between the host and the page.

The history lives in `storage.local`, kept by `src/background/cmdline_service.ts`. Completion is not here yet: `cmdline.next_completion` and `cmdline.prev_completion` are bound and do nothing until the completion piece lands.
