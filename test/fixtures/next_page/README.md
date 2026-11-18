# next_page

Saved pages for the `]]` detector (`src/content/next_page/detect.ts` and `load_more.ts`). `test/next_page/corpus.test.ts` runs the detector over each page with the default `next_patterns` and fails on any answer `labels.json` does not accept, so a wrong click or follow fails the suite.

- `<name>.json.gz`: one rendered page, captured logged out in a headless Firefox 1366 px wide, after scrolling to the end. It holds only what the detector reads: the element tree with shadow roots folded into their hosts, the box of each element in page coordinates (`r`), hidden (`h`), sideways scroller (`x`), fixed or sticky (`p`), a pointer cursor that starts at the element (`k`, the hints' click sign), the text of links, buttons and pointer elements (`s`) and a few attributes (`id`, every `data-*`, the full class list), the text length of each `p`, `pre` and `li` (`n`), and a mark `m: 1` on each shown element that the item selector of the shipped site row for the page's address matches (the oracle of `test/next_page/item_marks.test.ts`). Elements with no box, no control and nothing kept inside are dropped. Addresses keep only their paging and search parameters. `test/support/snapshot_page.ts` reads it.
- `labels.json`: per page, its address, the accepted answers (`ok`: the action, and for `follow` and `click` case-insensitive patterns on the target's text, `aria-label` or `href`) and why. `soft` marks an article or front page where `]]` must not scroll. `covers` names the next-pass rule the page guards. `no_next_word` asserts that no next word matches on the page at all. `finder` gives the kind of the page's main content (`list`, `grid` or `article`) and a minimum item count and, where a page once picked too much, a maximum (`max`), for the item finder's tests. `known_miss` names a control the detector does not find yet; the page then passes when the detector does nothing. `miss_as` pins the one wrong answer such a miss gives today, in the form of an `ok` answer.

To add or refresh a page, run `node tools/next_page_fixtures/capture.mjs <name> <url>` (it needs `firefox` on the path and network), then set its label by hand from what the page shows, never from what the detector answers. Sites change, so a refreshed page can need a new label. `node tools/next_page_fixtures/scrub.mjs` strips the tracking parameters from every saved page again.

On `youtube_watch`, the player's Next button has the box it has when the player controls show. At capture they were hidden.

`coverage_baseline.json` holds, per marked page, how many marks the main-list pick of `]]` covers; the item marks test compares against it and only reports a change. Rewrite it with `UPDATE_COVERAGE_BASELINE=1 npm test -- test/next_page/item_marks.test.ts` (or run that file with `node --test`).

A live page can load differently on each capture (bing shows 5 to 10 results, reddit pages may not reach the page end), so recapture until the labels hold and keep `finder.min` at what every capture gave.

Google sends a headless Firefox to its bot check, so `google` and `google_images` are not captured; capture them from a browser Google accepts when one is at hand. Pages with a row get marks only when captured through `capture.mjs` at the row's address.

The capture saves each text as `textContent`, while the live `]]` reads `innerText`, so whitespace and hidden text can differ from what the suite sees.
