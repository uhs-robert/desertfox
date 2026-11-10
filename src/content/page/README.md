# page

The `page` bundle (`page.js`, 4 KB limit). The background injects it into a frame on the first run of `scroll.align`, `copy.url`, `page.focus_input` or `page.stop`. These commands are rare, so their code stays out of `content.js`.

- `main.ts`: registers the four handlers with the host. `page.focus_input` also marks the field it focused as the entry of typed text (`../text/entry.ts`). The code itself sits in `../handlers/align.ts`, `copy.ts` and `focus_input.ts`, and `page.stop` is one `window.stop()` call. The last blurred field and the toast come from the host (`last_blurred_`, `show_toast_`), because this bundle has no copy of the content script's state.
