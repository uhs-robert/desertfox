# next_page

Saved pages for the `]]` detector (`src/content/hints/next_page.ts` and `load_more.ts`). `test/hints/next_page_corpus.test.ts` runs the detector over each page and fails on any answer `labels.json` does not accept, so a wrong click or follow fails the suite.

- `<name>.json.gz`: one rendered page, captured logged out in a headless Firefox 1366 px wide, after scrolling to the end. It holds only what the detector reads: the element tree with shadow roots folded into their hosts, the box of each element in page coordinates (`r`), hidden (`h`), sideways scroller (`x`), fixed or sticky (`p`), the text of links and buttons (`s`) and a few attributes. Elements with no box, no control and nothing kept inside are dropped. `test/support/snapshot_page.ts` reads it.
- `labels.json`: per page, its address, the accepted answers (`ok`: the action, and for `follow` and `click` case-insensitive patterns on the target's text, `aria-label` or `href`) and why. `soft` marks an article or front page where `]]` must not scroll. `covers` names the next-pass rule the page guards. `no_next_word` asserts that no next word matches on the page at all. `known_miss` names a control the detector does not find yet; the page then passes when the detector does nothing.

On `youtube_watch`, the player's Next button has the box it has when the player controls show. At capture they were hidden.
