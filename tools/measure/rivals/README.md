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

## Rerun

```
just measure-rivals                      # speed on all pages
PAGES=coverage just measure-rivals       # coverage alone
```

It needs Firefox, unzip and network access. Results go to `$MEASURE_DIR/rivals`, and load swings the numbers. See [`../README.md`](../README.md) for the settings.
