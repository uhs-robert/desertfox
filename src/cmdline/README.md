# cmdline

The command line: press `:` and a bar opens at the bottom. Type a command, press Enter, it runs.

- `host.ts`: the `cmdline` bundle (`cmdline.js`). The first `:` injects it into the page. It mounts the iframe in a closed shadow root, sets the `cmdline` mode, keeps the keys typed before the page is ready, and sends the parsed command to the background as a `run` message from the page's own frame. It closes itself if the page has not opened in 3 s, if the page removes the bar or sends the frame elsewhere, and on Escape even when the frame is gone.
- `page.ts`, `cmdline.html`: the page in the iframe (`cmdline_page.js`). It reads the stored keymap and runs its own matcher on the `cmdline` mode, because the content script's keys cannot reach into the iframe. Enter parses the line with `parse_command_line`, over the commands and aliases that `open_cmdline` returns, through `word_lookup.ts`, because the registry cannot load in a page. It loads the user CSS from the same answer after its own styles.
- `session.ts`: the text, the inline message and the history walk, apart from the DOM. A parse error keeps the line open and shows the error. Pure.
- `key_input.ts`: one key token to an effect, or to text when no key is bound. Pure.
- `history_cursor.ts`: Up and Down over the history with the draft kept. Pure.
- `protocol.ts`: the message shapes between the host and the page. Only `ready` and `start` use the page's window. The rest travels over a `MessageChannel` port handed over with `start`, so page scripts cannot read or forge it. The host gets a one-time ticket from the background and sends it in `start`, to the extension origin only. The page trades it for the history and commands, so a copy of `cmdline.html` that a site embeds on its own gets nothing.

The history lives in `storage.local`, kept by `src/background/cmdline_service.ts`. Completion is not here yet: `cmdline.next_completion` and `cmdline.prev_completion` are bound and do nothing until the completion piece lands.
