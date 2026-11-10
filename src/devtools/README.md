# devtools

The page that Firefox loads in each toolbox (`devtools_page` in the manifest). It builds as `devtools.js`, with its own 2 KB size limit in `tools/build.mjs`.

- `main.ts`: wires `run_page` to `browser.devtools.inspectedWindow` and `browser.runtime.connect`.
- `hand_off.ts`: `run_page` connects to the background with the name `devtools_inspect`, says which tab it inspects (`devtools_hello`) and, on each `devtools_pick`, evals one constant string that deletes `window.__desertfox_pick` and passes the node to `inspect()`. The string carries no page data. One eval reads and deletes together, so a second pick that lands in rapid mode is never deleted before its own message arrives, and a failed select leaves nothing on the page. Picks run one after another. A closed port is reopened after a second, which also covers a restarted background: its relay then sends the pick that waited.

The relay is `background/inspect_relay.ts`. The hints bundle sets the property (`content/hints/inspect.ts`).
