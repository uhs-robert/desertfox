# Performance comparison

How DesertFox compares with Vimium, Vimium C, Tridactyl and qutebrowser on hint speed, hint coverage and keyboard drag. The rig in this folder measures speed and coverage. Rival names appear here and in the root README only.

## Hint speed

Median time from the `f` key to the first hint label, cold (first press on a fresh page), in ms. Headless Firefox 160, 16 runs per cell, quiet machine, November 2026.

| Page | DesertFox | Vimium C | Tridactyl | Vimium |
| --- | --- | --- | --- | --- |
| 20,000 elements | 59 | 36 | 66 | 96 |
| Article | 77 | 20 | 68 | 86 |
| 100 iframes | 57 | 65 | 93 | 235 |

DesertFox's median stays under a tenth of a second on every page. It looks inside off-screen sections, because CSS can place visible content there, such as an open dropdown or a modal. Vimium C skips them on very large pages and misses targets there (next section).

## Coverage on very large pages

The test page has 16,000 filler elements and is about 29 screens tall. Targets sit in zero-size off-screen wrappers, pulled into view by CSS. Cell: runs of 3 in which the tool labeled the target after `f`. The Vimium C build is 2.12.3. Vimium C prunes off-screen boxes only on pages of at least 15,000 elements and more than 20 screens, so pages below that threshold gave every tool full coverage.

| Target | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Sticky header link, plain link, button, input | 3/3 | 3/3 | 3/3 | 3/3 |
| Dropdown items (2), tooltips (2), modal link and button, banner link | 3/3 | 3/3 | 0/3 | 3/3 |
| Visible targets labeled (of 11) | 11 | 11 | 4 | 11 |

qutebrowser was checked from source (a2a9c9d) and not run. Its hint code tests each element on its own, with no ancestor or page-size rule, so it labels all of them.

## Keyboard drag

Only DesertFox has built-in keyboard drag of elements (`;g`, `;G`). Checked from source: Vimium, Vimium C (2.12.3, the newest build), Tridactyl, qutebrowser, Surfingkeys, Vieb and cVim have none. Tridactyl `hint -h` selects text and moves nothing. Surfingkeys can do it with a user script. Other tools were not checked.

## Tab switch

Time to move to the next tab, in ms, on a quiet machine. Headless Firefox 160.0, 13 November 2026, load under 1 (0.08 before the run, 0.84 after, which includes the run). 24 runs per tool (12 runs x 2 passes, the warm-up run dropped). The tool order in pass 2 is the reverse of pass 1, to cancel drift. Cells are median, then IQR (Q1 to Q3).

| Hop | DesertFox | Vimium C | Vimium | Tridactyl |
| --- | --- | --- | --- | --- |
| Key pressed in a loaded tab | 13.0 (12.2-14.2) | 11.1 (10.7-11.7) | 11.4 (10.8-12.7) | 17.8 (17.1-19.3) |
| Unloaded tab to next tab | 54.6 (53.7-55.2) | 59.7 (58.2-61.4) | 62.5 (61.6-64.2) | 102.4 (101.0-105.3) |

Presses sent before the tab landed (median): DesertFox 4, Vimium 5, Vimium C 5 (max 19), Tridactyl 8 with 16 extra hops. These counts are not comparable across tools. The rig did not check how each tool treats keys that arrive early.

The rig has no no-extension baseline. With no extension there is no key to press, so the `none` row has no tab-switch runs and nothing here compares against plain Firefox.

```
PAGES=tabswitch RUNS=12 PASSES=2 just measure-rivals
```

## Table rows from source

Read from source in November 2026 (Vimium 49a3942, Vimium C 3188526, Tridactyl a296f07, qutebrowser a2a9c9d).

- **Key integrations for specific sites.** DesertFox ships one: Google Sheets, with `hjkl` cell movement, `x`, `y` and `p` through the page clipboard, and a visual range. Vimium has hint rules for Google Drive and the Docs file list (`siteSpecificClickables` in `link_hints.js`), which is why its cell is partial, but nothing for keys. Vimium C has no per-site rule table. Tridactyl treats `role=application` elements, which Google Sheets uses, as handling their own keys and stops capturing there, a generic rule keyed on the element and not on a site, with no `hjkl` and no clipboard, so it counts as no. qutebrowser ships site quirks (`content.site_specific_quirks`), such as a user-agent change for Google Docs, and none changes keys, so it counts as no.
- **Script on every page and frame.** From each tool's `manifest.json` (the pinned store builds for the rivals): DesertFox, Vimium and Vimium C set `all_frames` and so load their script in every frame. Tridactyl does not set it, so its script loads in the top page only. Sizes are as shipped.

## Rerun

```
just measure-rivals                      # speed on all pages
PAGES=coverage just measure-rivals       # coverage alone
```

It needs Firefox, unzip and network access. Results go to `$MEASURE_DIR/rivals`, and load swings the numbers. See [`../README.md`](../README.md) for the settings.
