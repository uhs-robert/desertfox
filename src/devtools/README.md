# devtools

The page that Firefox loads in each toolbox (`devtools_page` in the manifest). It builds as `devtools.js`.

Behavior is in `docs/design/interfaces_hints.md`, section "Devtools files for hints".

- `main.ts`: wires `run_page` to `browser.devtools.inspectedWindow` and `browser.runtime.connect`.
- `hand_off.ts`: `run_page`: the connection to the background and the `inspect()` call for each pick.
- `devtools.html`: the page the manifest points `devtools_page` at. It only loads `devtools.js`.

Rules across files:

- The relay is `src/background/inspect_relay.ts`. The hints bundle sets the pick property (`src/content/hints/inspect.ts`).
