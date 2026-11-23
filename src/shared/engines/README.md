# engines

Search engines as named URL templates. Pure code with no browser calls. It sits outside the shared barrel, so the content script never bundles it.

Behavior is in `docs/design/config.md`, section "Engine files for the config".

- `slots.ts`: the slot table: the input slot `query` and the page slots, each with a pure `read(page)`.
- `fill.ts`: parses and fills a template.
- `resolve.ts`: turns the TOML tree into a flat map keyed by the dotted name. `tools/build-config` only.
- `reverse.ts`: the inverse of `fill.ts`: reads a query out of a results page address, and picks the engine of a page.
- `index.ts`: the exports.

Rules across files:

- The extension stores the resolved map and fills the slots at run time in `src/shared/url_build.ts`. The availability check is `src/background/availability.ts`.
