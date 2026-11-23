# newtab

The new tab page. The manifest sets `chrome_url_overrides.newtab` to `newtab.html`, so the page owns every new tab.

Behavior is in `docs/design/interfaces_pages.md`, section "New tab files for the new tab page".

- `main.ts`: reads `new_tab_page`: a web URL redirects, anything else draws the built-in page through `render.ts`.
- `render.ts`: draws the built-in page: clock, date, lists, widgets and cards. Redraws on a setting change.
- `lists.ts`: the rows under the clock: `[[newtab_links]]` by group, Recent tabs and Bookmarks.
- `widgets.ts`: the Recently closed and Top sites rows.
- `cmdline_key.ts`: reads the key bound to `cmdline.open`, for the command hint button.
- `tile.ts`: one card per row: icon box, title and host, as one anchor.
- `net_widget.ts`: the one fetch-and-cache helper for cards that use the network.
- `weather.ts`: the weather card (`newtab_weather`, Open-Meteo).
- `weather_detail.ts`: what the weather More button opens: the hour strip, UV index, sunrise and sunset.
- `weather_icon.ts`: the line icon for a weather code.
- `air_quality.ts`: the air quality row in the More panel.
- `ip_info.ts`: the opt-in IP info line (`newtab_ip_info`).
- `clock.ts`: the 12 hour SVG clock without ticks.
- `digital_clock.ts`: the digital clock in seven-segment digits. `fonts/` holds the DSEG7 font and its OFL text.
- `newtab.html`: the page, its styles, the built-in links and the Settings gear as plain anchors.

Rules across files:

- The favicon cache is `src/shared/page/icon_cache.ts`, filled by `src/background/favicon_saver.ts`. `lists.ts` reads it. The page loads no remote icon.
- Only `net_widget.ts` fetches. It checks no setting and no privacy, so every card that uses it must check both first.
- `newtab.html` links `src/shared/page_base.css` first and needs no edit for a new bundle, since `main.ts` adds the tag on request (`src/shared/page_bundle_tag.ts`).
