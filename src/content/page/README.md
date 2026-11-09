# page

The `page` bundle (`page.js`, 4 KB limit). The background injects it into a frame on the first run of `scroll.align` or `copy.url`. These commands are rare, so their code stays out of `content.js`.

- `main.ts`: registers the two handlers with the host. The code itself sits in `../handlers/align.ts` and `copy.ts`. The last blurred field and the toast come from the host (`last_blurred_`, `show_toast_`), because this bundle has no copy of the content script's state.
