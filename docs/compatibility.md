# Site compatibility

This page lists the sites DesertFox was checked on, what it does there, and how three other keyboard extensions for Firefox do on the same checks. A different design choice is not a defect, and the notes say so where the tools differ by design.

## How to read the table

Every result cell (the DesertFox status and rival columns) starts with an evidence tag. The integration column names code paths and tests, which come from a code read, and the notes carry no tag of their own.

| Tag | Meaning |
| --- | --- |
| R | Rig run on the live site, 2026-11-14. `PAGES=sites PASSES=3 just measure-rivals`, see [`tools/measure/rivals/README.md`](../tools/measure/rivals/README.md). |
| H | Hand check in a real browser session, with the date. Steps in [`tools/measure/rivals/hand_checks.md`](../tools/measure/rivals/hand_checks.md). |
| A | Automated test on a local stand-in page, never the live site. The test file is named. |
| S | Source check: the project's code was read, nothing was run. |

Versions for every R cell: Firefox 160.0 (headless, fresh profile per tool, default keys and settings), DesertFox 0.1.24, Vimium 2.4.2, Vimium C 2.12.3, Tridactyl 1.25.1. Three passes per site and tool. A cell shows the result most passes gave. A count such as 2/3 means the passes differed. The rig output is dated 2026-11-14. Run 7b covers every site (rig commit `88b037dc`, which has the label picker fix, with the extension build stamped `eb5086b1` in the run metadata). Run 8b (build stamp `c77c6e05`) reran Reddit and X, and the table takes those two rows from it. The DesertFox build of run 7b predates #656, which affects only the embed `play` result. Network and site changes move these results, so a rig run is a dated snapshot and not a test.

Each R cell scores three steps on one page load:

1. Mode on load. Information only. A tool that starts in insert mode where the site focused a field is correct.
2. Leave. Can the tool's `Escape` leave the field the site focused, also in a frame? A tool that thinks it is in normal mode while a frame still holds typing focus fails this step.
3. Normal mode. Scroll with `j`, hints with `f`, `Escape` out of hints, and activating a hint. `blocked` means nothing happened. `not scored` and `rig limit` mean the rig cannot judge the check on that page. `wrong target` means the hint acted on another element than the labelled one.

A cell reads `pass` when every scored check passed, and otherwise lists the checks that did not. Site-specific checks (`cell move`, `play`, `volume`, `j/k`) are named where they apply. `no default key` means the tool has no key for that action, so the check did not run.

## Frame mode

The site dictates focus, and DesertFox does not override it. A site that points focus into a frame, such as the Google sign-in popup on Reddit and X, leaves DesertFox working inside that frame. It stays there until the user dismisses the frame or leaves with `gF`. Scroll waits until the frame is dismissed. Hints work inside the frame and one of them can dismiss it. The mode badge reads FRAME while this lasts.

The other three tools keep keys on the page instead. That is a different design choice, and on Reddit and X their keys act on the page. The rig scores DesertFox in frame mode by three checks: `gF` leaves the frame, hints appear inside the frame, and a typed hint label reacts. The judge passes when the top page keeps its address and the frame goes away (a dismissal), and also when the frame sees a click or focus on one of its elements while it stays open. A top-page navigation fails. On Reddit and X all six DesertFox passes (3 each, run 8b) read "the frame went away (dismissed)", so each was a dismissal. Source for the design and the Google Docs case: [`design.md`](design.md) and "Frame focus and the tab's mode" in [`firefox-behavior.md`](firefox-behavior.md).

## Sites

Public sites are R cells. Sites behind a login are `hand check pending`: the rig cannot log in, so these sites are checked by hand.

| Site | DesertFox status | Site integration | Vimium | Vimium C | Tridactyl | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube (watch page) | R: pass, including play and volume | Yes. Media keys act on the player, volume steps through the player: `src/content/media/`, `src/content/quality/youtube.ts`. A: `test/key/p23_media_keys.mjs`, `test/content/quality.test.ts` | R: pass. `play` and `volume`: no default key | R: pass. `play` and `volume`: no default key | R: pass. `play` and `volume`: no default key | The three rivals pass the generic checks. The rig found no default key in them for play or volume. |
| Google Sheets (public sheet, view mode) | R: leave pass, cell move pass. Scroll not scored. Activate: rig limit (landed on `div#docs-chrome`) | Yes. Row `sheets` in `src/background/default_site_rows.ts` (`hjkl` cell movement, clipboard keys, visual range), handlers in `src/content/site_actions/`. A: `test/key/p25_site_keys.mjs` | R: leave pass. Cell move blocked. Scroll not scored | R: leave pass. Cell move blocked. Scroll not scored. Activate: rig limit (landed on `div#docs-chrome`) | R: leave pass. Cell move blocked. Scroll not scored. Activate: rig limit (landed on `div#docs-chrome`) | Focus starts in the cell editor (`div#waffle-rich-text-editor`) and all four tools leave it. Scroll is not scored for any tool: the rig found no scrollable element, because the grid scrolls itself. DesertFox `j` moves the cell on Sheets by design. Edit mode needs a login and is not checked. |
| Google Docs (public doc, view mode) | R: leave pass, scroll pass, hints pass. Activate: rig limit (landed on `div#docs-chrome`, not the labelled element). H 2026-11-13: starts in insert mode, and after `Escape` scroll, hints and the rest work | No. Works through generic hidden-frame handling, see `firefox-behavior.md` | R: leave pass. Scroll and activate blocked | R: leave fail (focus stays in the text frame). Hints, hints `Escape`, activate and scroll blocked | R: leave pass. Scroll blocked. Activate: rig limit (landed on `div#docs-chrome`) | Docs focuses a hidden text frame on load, so insert mode on load is correct. Only DesertFox scrolled in the rig. Activation is a rig limit where a tool landed on `div#docs-chrome`, the same container as on Sheets. Vimium and Vimium C activation is blocked, so activation is not comparable here. |
| Wikipedia | R: pass | No | R: pass | R: pass | R: pass | |
| GitHub | R: pass | No. The search engine slot `{repo}` only searches from the page | R: pass | R: pass | R: pass | |
| Hacker News | R: leave, scroll, hints pass. Activate: rig limit | No | R: activate rig limit. Rest pass | R: pass | R: activate rig limit. Rest pass | Rig limit: the rig typed the label and landed on an adjacent link, not the story link, for DesertFox, Vimium (the upvote link) and Tridactyl (a `from?site=` link). Vimium C passed. The cells are not comparable on activation. |
| Reddit (logged out) | R: pass, with frame mode. `gF`, hints in the frame and dismissal pass. H 2026-11-13: frame mode, hints in the frame and dismissal work | No. The search engine slot `{subreddit}` only searches from the page | R: pass | R: pass | R: pass | The Google sign-in popup takes focus on load, see Frame mode. Rows from run 8b. |
| X (logged out) | R: pass, with frame mode. `gF`, hints in the frame and dismissal pass | No | R: pass, `j/k` pass | R: pass, `j/k` pass | R: pass, `j/k` pass | Same sign-in popup as Reddit. `j/k` pass means the tool's `j` scrolled and X's own `j` did not run. Rows from run 8b. |
| Google Maps | R: leave pass, hints pass, activate pass. Scroll not scored | No | R: pass. Scroll not scored | R: pass. Scroll not scored | R: activate wrong target. Scroll not scored | Starts in insert mode on a text input. All four leave it. Scroll is not scored for any tool: the rig found no scrollable element. |
| Excalidraw | R: pass. Scroll not scored | No | R: pass. Scroll not scored | R: pass. Scroll not scored | R: pass. Scroll not scored | Scroll is not scored for any tool: the rig found no scrollable element (the page draws its own canvas). |
| StackBlitz | R: leave pass, hints pass, activate pass. Scroll not scored | No | R: pass. Scroll not scored | R: pass. Scroll not scored | R: activate wrong target. Scroll not scored | Starts in insert mode in a textarea. All four leave it. |
| Notion (public page) | R: pass | No | R: scroll blocked, rest pass | R: pass | R: scroll blocked, rest pass | |
| Google Search | R: pass | No | R: pass | R: pass | R: pass | |
| Amazon | R: scroll blocked, rest pass | No | R: scroll blocked, rest pass | R: scroll 2/3 pass, activate 2/3 pass | R: scroll 2/3 blocked, activate 2/3 wrong target | Results differ between passes, so read this row as noisy. |
| Stack Overflow | R: pass. Frame checks n/a | No | R: pass. Frame checks n/a | R: pass. Frame checks n/a | R: pass. Frame checks n/a | Focus starts on a consent banner (`div#onetrust-banner-sdk`). In run 7b DesertFox never entered frame mode here, so the frame checks do not apply. |
| MDN | R: pass | No | R: pass | R: pass | R: pass | |
| Twitch | R: pass | No | R: pass | R: pass | R: scroll blocked, rest pass | |
| Firefox PDF viewer (`arxiv.org/pdf`) | R: scroll pass. Hints, hints `Escape` and activate blocked. Firefox limit | No | R: same as DesertFox | R: same as DesertFox | R: same as DesertFox | Firefox runs no extension content script in its PDF viewer, so no tool can add keys or hints there. The scroll passes because the viewer scrolls on its own `j`. Source: "Keys in PDF files" in `firefox-behavior.md` and the PDF viewer line of `design.md`. |
| YouTube video embedded in another site | R: volume pass, scroll pass, hints pass, activate pass. `play` pass (R, 2026-11-14, 3 of 3, DesertFox build of main 96635fc8) | Yes, same media code as YouTube | R: pass. `play` and `volume`: no default key | R: pass. `play` and `volume`: no default key | R: hints, hints `Escape` and activate blocked. `play` and `volume`: no default key | The rig loads the live YouTube player into a local fixture page. The generic hint and activation checks target the link beside the player, not the player's controls. Run 7b read `play` as blocked (player state 5) on a build that predates the `ap` fix in #656. The rerun (R, 2026-11-14, main 96635fc8) passes 3 of 3, and the build just before the fix reproduces state 5. In that rerun the three rivals read "no default key" for play and volume, 3 of 3. |
| Google Drive (login) | Hand check pending | No code, no test | Hand check pending | Hand check pending | Hand check pending | S: Vimium has hint rules for Drive and the Docs file list (`siteSpecificClickables` in `link_hints.js`, commit `49a3942`, read November 2026). It has no key rules. DesertFox, Vimium C and Tridactyl have no Drive rule. |
| Gmail (login) | Hand check pending | No | Hand check pending | Hand check pending | Hand check pending | |
| Figma (login) | Hand check pending | No | Hand check pending | Hand check pending | Hand check pending | Also check that Figma's own single-letter keys still work on the canvas. |
| Slack or Discord (login) | Hand check pending | No | Hand check pending | Hand check pending | Hand check pending | |
| Outlook or Microsoft 365 (login) | Hand check pending | No | Hand check pending | Hand check pending | Hand check pending | |
| ChatGPT or Claude web (login) | Hand check pending | No | Hand check pending | Hand check pending | Hand check pending | |

## Source checks of the rivals

These are code reads, not runs (the table's S tag). The full text is in "Table rows from source" in [`tools/measure/rivals/README.md`](../tools/measure/rivals/README.md).

- Vimium has hint rules for Google Drive and the Docs file list and no per-site key rules. DesertFox ships one key integration, Google Sheets.
- Vimium C has no per-site rule table.
- Tridactyl treats `role=application` elements, which Google Sheets uses, as handling their own keys and stops capturing there. The rule is generic, with no `hjkl` and no clipboard keys.
