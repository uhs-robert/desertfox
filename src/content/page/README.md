# page

The `page` bundle (`page.js`, 4 KB limit). The background injects it into a frame on the first run of `scroll.align`, `copy.url`, `page.focus_input`, `mark.add` or `mark.jump`. These commands are rare, so their code stays out of `content.js`.

- `main.ts`: registers the five handlers with the host. `mark.add` and `mark.jump` read the scroll box through the host (`scroll_box_`, which ends a smooth scroll in flight, because that state lives in `content.js`) and talk to the background mark store, and a jump scrolls with `behavior: "instant"`. `page.focus_input` also marks the field it focused as the entry of typed text (`../text/entry.ts`). The code of the other three sits in `../handlers/align.ts`, `copy.ts` and `focus_input.ts`. The mark code sits in `main.ts`. The last blurred field and the toast come from the host (`last_blurred_`, `show_toast_`), because this bundle has no copy of the content script's state.
