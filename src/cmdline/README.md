# cmdline

The command line: press `:` and a bar opens at the bottom. Type a command, press Enter, it runs.

- `host.ts`: the `cmdline` bundle (`cmdline.js`): mounts the page in an iframe, holds the keys typed before it is ready and sends the parsed command to the background.
- `style.ts`: the page's sheet (`CMDLINE_STYLE`). Pure text with no imports, so DesertBird can vendor it.
- `cmdline.html`: the page in the iframe. `tools/build.mjs` puts `CMDLINE_STYLE` in at the `<!--cmdline-style-->` marker.
- `page.ts`: the page in the iframe (`cmdline_page.js`): its own matcher over the stored keymap, and Enter parses the line with `parse_command_line`.
- `session.ts`: the text, the inline message, the completion list and the history walk, apart from the DOM. Pure.
- Completion: what the list offers is in `src/shared/completion/` (see its README), because the omnibox in the background builds the same rows.
- `list.ts`: draws the rows, ten at most, as a window that follows the selection.
- `status.ts`: the labels and the security state of the status widgets (`status_widgets`). Pure.
- `key_input.ts`: one key token to an effect, or to text when no key is bound. A step that `waits` (the session's `waits_for_rows`) comes back as a hold with the steps left. Pure.
- `wheel.ts`: turns wheel events into whole list rows. Trackpad pixel deltas add up until they pass one row, and a mouse notch moves 3 rows.
- `history_cursor.ts`: Up and Down over the history with the draft kept. Pure.
- `protocol.ts`: the message shapes between the host and the page. Only `ready` and `start` use the page's window.

The detail of the host, the page, the list and the keys is in "Command line files for the command line page" in `docs/design/interfaces_cmdline.md`.
