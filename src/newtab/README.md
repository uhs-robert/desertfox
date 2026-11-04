# newtab

The new tab page. The manifest sets `chrome_url_overrides.newtab` to `newtab.html`, so the page owns every new tab.

- `main.ts`: reads the `new_tab_page` setting through `resolve_new_tab_page` (`shared/config.ts`). A web URL redirects with `location.replace`, so the content script runs on that site as on any page. Anything else draws the built-in page, and so does `newtab.html?builtin`, which `home_page = "oasisfox"` opens.
- `render.ts`: draws the built-in page and loads the optional widgets. Clock and date show unless their setting is `false`. IP and weather show only when their setting is `true`.
- `clock.ts`, `ip.ts`, `weather.ts`: the 24 hour SVG clock, the `ipwho.is` lookup and the Open-Meteo reading. Each parser returns null on a bad reply, which hides that widget.
- `cache.ts`: keeps a reply in `storage.local` for 5 minutes. These two requests are the only data that leave the machine: the service sees the public address, and Open-Meteo sees the coordinates.
- `newtab.html`: the page and its styles. Keys, hints, which-key and `:` come from scripts loaded by tag: `executeScript` cannot reach extension pages, so the lazy bundles cannot load on request. Each bundle registers itself on load and the content script finds it already there. Add `caret.js` to the page when caret mode should work on it.

Firefox gives the address bar focus on Ctrl+T. Press Esc or click the page before the keys work.

After Firefox's one-time "Your new tab has changed" notice, its hidden Keep Changes button keeps access key K for that browser session. So Alt+K (previous tab) does nothing on about: pages until a restart. Accepting the notice once avoids it.
