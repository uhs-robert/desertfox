# newtab

The new tab page. The manifest sets `chrome_url_overrides.newtab` to `newtab.html`, so the page owns every new tab.

- `main.ts`: reads the `new_tab_page` setting through `resolve_new_tab_page` (`shared/config.ts`). A web URL redirects with `location.replace`, so the content script runs on that site as on any page. Anything else draws the built-in page.
- `render.ts`: draws the built-in page.
- `newtab.html`: the page and its styles. Keys, hints, which-key and `:` come from scripts loaded by tag: `executeScript` cannot reach extension pages, so the lazy bundles cannot load on request. Each bundle registers itself on load and the content script finds it already there. Add `caret.js` to the page when caret mode should work on it.

Firefox gives the address bar focus on Ctrl+T. Press Esc or click the page before the keys work.
