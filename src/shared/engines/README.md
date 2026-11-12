# engines

Search engines as named URL templates. Pure code with no browser calls. It sits outside the shared barrel, so the content script never bundles it.

- `slots.ts`: the slot table. An input slot is `query`. A page slot (`url`, `host`, `title`, `repo`, `subreddit`, `channel`) has a pure `read(page)` and the message shown when the page cannot fill it.
- `fill.ts`: parses and fills a template. `{a|b}` takes the first alternative with a value, `{name:raw}` skips escaping, `%s` reads as `{query}`. Slot values take `encodeURIComponent` whatever the position, and a space in the literal text becomes `%20`.
- `resolve.ts`: turns the TOML tree into a flat map keyed by the dotted name. It runs in `tools/build-config` only. The rules (inheritance, params, generated children, `only`, reserved names) are in `docs/design.md`, "Engines".
- `reverse.ts`: the inverse of `fill.ts`. `read_query` reads the query out of an engine's results page address by its template or its `reverse` regex, and `engine_of_page` picks the engine that owns a page (longest fixed template start wins). The `search_query` context source calls it.
- `index.ts`: the exports.

The extension stores the resolved map and fills the page slots and the query at run time (`src/commands/url_build.ts`, `engine_url`). The availability check lives in `src/background/availability.ts`.
