# newtab

The new tab page. The manifest sets `chrome_url_overrides.newtab` to `newtab.html`, so the page owns every new tab.

- `main.ts`: reads the `new_tab_page` setting through `resolve_new_tab_page` (`shared/config.ts`). A web URL redirects with `location.replace`, so the content script runs on that site as on any page. Anything else draws the built-in page, and so does `newtab.html?builtin`, which `home_page = "desertfox"` opens.
- `render.ts`: draws the built-in page: the clock and the date, each on unless its setting is `false`. `newtab_clock` is analog for `true` or `"analog"` and digital for `"digital"`. A 1 second tick moves the hands and rewrites the date, so a tab left open past midnight shows the new day.
- `clock.ts`: the 12 hour SVG clock without ticks. Hand angles keep growing past 360 so the CSS transition never rewinds at a wrap.
- `digital_clock.ts`: the digital clock, `HH:mm` in seven-segment digits, with an AM or PM suffix when `newtab_clock_format` is 12 (the default). `fonts/` holds the font, DSEG7 Classic by keshikan, unmodified with its SIL OFL 1.1 text. The licence reserves the name "DSEG", so do not convert or edit the file. Only `newtab.html` declares it.
- `newtab.html`: the page and its styles, and the built-in links (Getting Started, Help, Settings) as plain anchors in a fixed `nav`, so hints reach them. Keys, hints, which-key and `:` come from scripts loaded by tag: `executeScript` cannot reach extension pages, so the lazy bundles cannot load on request. Each bundle registers itself on load and the content script finds it already there. Add `caret.js` to the page when caret mode should work on it.

Firefox gives the address bar focus on Ctrl+T. Press Esc or click the page before the keys work.

After Firefox's one-time "Your new tab has changed" notice, its hidden Keep Changes button keeps access key K for that browser session. So Alt+K (previous tab) does nothing on about: pages until a restart. Accepting the notice once avoids it.
