# page

The `page` bundle (`page.js`, 4 KB limit). The background injects it into a frame on the first run of `scroll.align`, `copy.url`, or `page.focus_input`. These commands are rare, so their code stays out of `content.js`.

- `main.ts`: registers the three handlers with the host. The code itself sits in `../handlers/align.ts`, `copy.ts` and `focus_input.ts`. The last blurred field and the toast come from the host (`last_blurred_`, `show_toast_`), because this bundle has no copy of the content script's state.
