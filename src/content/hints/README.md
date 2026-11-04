# hints

The `hints` bundle (`hints.js`). The background injects it into a frame on the first `hint.run` or the first entry into `hint` mode.

- `main.ts`: registers the `hint` sink and the `hint.run` handler. `hint.run` enters hint mode at once, finds the visible elements, draws labels and waits for one to be typed. Keys typed while it finds elements wait and replay. Reads the `hint_letters` setting from the stored config status. With `rapid`, a pick keeps hint mode and builds the hints again, so deleted or moved elements stay right, and Escape ends it. With `text`, only links whose text holds it (ignoring case) get labels. One match runs at once and ends hint mode, also with `rapid`. None shows "No link matches ...". A custom selector that does not parse shows a notice.
- `candidates.ts`: one selector per filter, and a walk that reaches open and closed shadow roots and same-origin frames. A cross-origin frame hints through its own copy of the bundle.
- `visible.ts`: keeps what a person can click: inside every scrolling box, not hidden, and not under another element, tested in each parent document for a framed element. Reads the page only through `PageProbe`, so tests use a fake page.
- `labels.ts`, `pick.ts`: the label generator (prefix-free, built from the letters) and the typing rules. Pure.
- `actions.ts`: what a picked element gets: click or focus, open in a place, copy the address (`copy`, the text for a non-link) or the text (`copy_text`), focus, delete. `caret` and `visual` hand the element to the caret bundle (see `caret/start_point.ts`) and ignore `rapid`.
- `view.ts`: labels in a closed shadow root. They use the which-key colors: `--oasisfox-secondary` text and `--oasisfox-accent` border on the `--oasisfox-bg` background.
- `follow.ts`: repositions the labels on the next animation frame after a scroll or resize in the top window or a frame window.

The registry never imports this folder. The command and its params sit in `src/commands/hint.ts`.
