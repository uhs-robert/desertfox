# Performance comparison

How DesertFox compares with Vimium, Vimium C, Tridactyl and qutebrowser on hint speed, hint coverage and keyboard drag. The rig in this folder measures speed and coverage. Rival names appear here and in the root README only.

## Hint speed

Median time from the `f` key to the first hint label, cold (first press on a fresh page), in ms. Headless Firefox 160.0, 16 runs per cell, 14 November 2026, DesertFox at commit f7652c1f. The 1-minute load average stayed under 1.9 for the whole run.

| Page | DesertFox | Vimium C | Tridactyl | Vimium |
| --- | --- | --- | --- | --- |
| 20,000 elements | 56 | 36 | 57 | 92 |
| Article | 73 | 19 | 61 | 79 |
| 100 iframes | 50 | 57 | 89 | 194 |

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

## Page memory and load

Measured on 14 November 2026 at DesertFox commit f7652c1f, headless Firefox 160.0, on one machine. Each tool ran alone in a fresh profile, 16 runs per cell (8 runs x 2 passes). The 1-minute load average started at 0.41 and peaked at 1.86, with a mean of 0.49. Memory is resident set size (RSS, the memory the process holds in RAM). It varies with the machine and the Firefox version, so read the gaps and not the absolute figures.

Page content process RSS after load, in MB. The delta is the cost over the `none` column, which has no extension. Deltas come from the unrounded medians, so they can differ by 0.1 from the difference of the printed values.

| Page | none | DesertFox | Vimium C | Vimium | Tridactyl |
| --- | --- | --- | --- | --- | --- |
| 20,000 elements | 49.5 | 55.9 (+6.4) | 54.3 (+4.8) | 55.6 (+6.1) | 63.8 (+14.3) |
| Article | 79.0 | 87.2 (+8.1) | 83.7 (+4.7) | 87.5 (+8.5) | 90.6 (+11.6) |
| 100 iframes | 59.9 | 81.1 (+21.3) | 112 (+52.3) | 131 (+71.1) | 83.9 (+24.0) |
| 100 iframes page, top page alone | 19.9 | 24.5 (+4.5) | 24.1 (+4.1) | 25.9 (+5.9) | 31.8 (+11.9) |

Extension process RSS after load, in MB, the same on every page: none 36.4, DesertFox 53.7, Vimium C 51.3, Vimium 37.3, Tridactyl 45.5. Each tool has one such process, so this cost is paid once and not per tab. Vimium C reads 54.0 on the 100 iframes page.

Caveats:

- One machine and one Firefox build.
- Each tool ran in its own Firefox process, and that process stays up across the pages of a pass. The rig samples the extension process after every page load, so each page cell is the median of 16 samples, 8 from each of two processes (one per pass). The medians match across pages for that reason. Across all samples the range was 52.5 to 55.0 for DesertFox, 36.7 to 38.3 for Vimium, 51.2 to 54.7 for Vimium C, 45.0 to 46.0 for Tridactyl and 36.3 to 38.2 for none.

Page-load cost on the article page (a saved article of 2.0 MB) against no extension:

- DesertFox adds about 13 to 17 ms to the load event. Over three rounds the cost was +17.8, +7.8 and +15.5 ms (+13.1 pooled), so single rounds fall outside the range.
- It adds about 15 ms to DOMContentLoaded (+14.8 pooled).
- A page load gap under 100 ms reads as instant to a user, so these figures are far below what a user notices.
- The rivals run on the same page (16 runs) gave +17 ms for DesertFox, +21 for Vimium, +19 for Vimium C and +80 for Tridactyl.

Method: `run.mjs` on the `wiki` page, with no extension and DesertFox interleaved over three rounds of 13 runs each (39 per variant). The helper script checked that the 1-minute load average was under 3 before each variant's 13 runs, not before every run. The highest load sampled during a variant was 1.44.

This command covers the memory and hint-speed run only:

```
MEASURE_DIR=<dir outside /tmp> RUNS=8 PASSES=2 just measure-rivals
```

The article comparison used `run.mjs` directly. A helper script that lives outside the repo ran it, so the steps are given here with the in-repo commands. Run them from the repo root. First run the command above once, so that `$MEASURE_DIR/rivals` holds the saved article. Then run each variant on its own, with `RIVALS_DIR` set to that folder:

```
RIVALS_DIR=$MEASURE_DIR/rivals PAGES=wiki PASS=1 node tools/measure/rivals/run.mjs none 12
RIVALS_DIR=$MEASURE_DIR/rivals PAGES=wiki PASS=1 node tools/measure/rivals/run.mjs desertfox 12
```

Each call makes 13 runs (12 timed and the warm-up run) and writes `$RIVALS_DIR/out/<tool>.p1.json`, which the next call overwrites, so copy it away. Alternate the order over three rounds: none then DesertFox, DesertFox then none, none then DesertFox. Before each call, wait until the 1-minute load average is under 3. The cost is the median load event of DesertFox over its 39 runs minus the median of none over its 39 runs.

## Tab switch

Time to move to the next tab, in ms, on a quiet machine. Headless Firefox 160.0, 13 November 2026, load under 1 (0.08 before the run, 0.84 after, which includes the run). 24 runs per tool (12 runs x 2 passes, the warm-up run dropped). The tool order in pass 2 is the reverse of pass 1, to limit drift. Cells are median, then IQR (Q1 to Q3).

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

- **Key integrations for specific sites.** DesertFox ships one: Google Sheets, with `hjkl` cell movement, `x`, `y` and `p` through the page clipboard, and a visual range. Vimium has hint rules for Google Drive and the Docs file list (`siteSpecificClickables` in `link_hints.js`), which are not key integrations, so its cell is no. Vimium C has no per-site rule table. Tridactyl treats `role=application` elements, which Google Sheets uses, as handling their own keys and stops capturing there, a generic rule keyed on the element and not on a site, with no `hjkl` and no clipboard, so it counts as no. qutebrowser ships site quirks (`content.site_specific_quirks`), such as a user-agent change for Google Docs, and none changes keys, so it counts as no.
- **Script on every page and frame.** From each tool's `manifest.json` (the pinned store builds for the rivals): DesertFox, Vimium and Vimium C set `all_frames` and so load their script in every frame. Tridactyl does not set it, so its script loads in the top page only. Sizes are as shipped.

## Compare by hand

Three commands open the tools side by side for a hands-on check. Each tool gets its own visible Firefox window in a fresh profile under `~/.cache/desertfox-compare/` (apart from the rig's profiles). DesertFox is built from the current checkout. The rivals are the pinned builds from `tools.mjs`, checked against their sha256.

```
just compare <url>...       # one window per tool: a tab naming the tool, then the URLs
just compare --tool <name> <url>...   # only that tool's window (desertfox, vimium, vimiumc or tridactyl)
just compare-add <url>      # open a URL as the active tab in every open window
just compare-close          # close only these windows, by recorded pid, and delete their profiles
```

`just compare` first drops windows you closed by hand from the state file, leaves the windows that still run, and opens only the tools that have none. A window that runs already does not get the URLs: use `just compare-add`.

The windows open wherever the desktop puts them. The add-ons are temporary installs, so a window restart drops its add-on. Close and run `just compare` again instead.

Check with the keyboard alone, in every window, with each tool's default keys:

- Movement: scroll, page up and down, top and bottom.
- Hints: open the hints, follow a link, leave with `Escape`.
- Leaving a field: focus a text field, type, and get back to the page keys.
- Frames from other sites: hints and scrolling inside an embedded frame.

Record each result in [`hand_checks.md`](hand_checks.md), the (H) cells in the rig's tables: one line per tool and check, `pass` or `fail`, plus a short reason when it fails.

## Rerun

```
just measure-rivals                      # speed on all pages
PAGES=coverage just measure-rivals       # coverage alone
PAGES=sites PASSES=3 just measure-rivals # checks on live public sites
```

Login sites are checked by hand with [`hand_checks.md`](hand_checks.md).

Site notes for the live-site checks (the `SITES` list in `sites.mjs`):

- `activate_selector` names the element every tool must activate on that site. Hacker News uses `.titleline > a`, because a label can hang off the story link onto the vote arrow beside it. The activation record keeps `label_rect` and `target_rect`, so a wrong pick can be read from the saved JSON.
- `scroll_probe` marks a canvas or grid site (Sheets, Maps, Excalidraw, StackBlitz) where no element scrolls. The check reads whether the view or the selection moved. The `none` column is an unscored control there: a click into the work area, then the site's own movement input. A control that moves nothing adds a note to every tool's cell.
- The scored `scroll` row (the tool's own `j`) and `passthrough` row (the site's ArrowDown with the tool active) start from the keyboard alone, on the page as loaded. The tool's leave key goes out only when focus is in a typing field. A site with a `work_area` then gets Tab presses, up to 30, until focus is inside it. The count goes in the row's note.

It needs Firefox, unzip and network access. Results go to `$MEASURE_DIR/rivals`, and load swings the numbers. See [`../README.md`](../README.md) for the settings.
