# Site compatibility

The sites DesertFox was checked on, what it does there, and how three other keyboard extensions for Firefox do on the same checks. A different design choice is not a defect, and the notes say so where it applies.

## How to read the table

Each result cell is a mark and an evidence tag, such as `✅ R`.

| Mark | Meaning |
| --- | --- |
| ✅ | Every scored check passed. |
| ⚠️ | The tool passes some scored checks and fails or is blocked on others, or the result differs between passes. The note says which. |
| ❌ | Every scored check failed or was blocked. |
| n/a | The check does not apply. |
| pending | The check is not done yet. |

| Tag | Meaning |
| --- | --- |
| R | Rig run on the live site. `PAGES=sites PASSES=3 just measure-rivals`, see [`tools/measure/rivals/README.md`](../tools/measure/rivals/README.md). |
| H | Hand check in a real browser session. Steps in [`tools/measure/rivals/hand_checks.md`](../tools/measure/rivals/hand_checks.md). |
| A | Automated test on a local stand-in page, never the live site. |
| S | Source check: the project's code was read, nothing was run. |

All R cells: 2026-11-14, Firefox 160.0 (headless, fresh profile per tool, default keys and settings), DesertFox 0.1.24, Vimium 2.4.2, Vimium C 2.12.3, Tridactyl 1.25.1, three passes per site and tool. A cell shows the result most passes gave. Run 7b covers every site (rig commit `88b037dc`, extension build `eb5086b1`). Run 8b (build `c77c6e05`) reran Reddit and X. The run 7b build predates #656, which affects only the embed `play` result. A rig run is a dated snapshot, not a test, because sites change.

Each R cell scores three steps on one page load: the tool's `Escape` leaves the field the site focused, then scroll (`j`), hints (`f`), `Escape` out of hints and activating a hint work. Where a site has its own check, such as cell move, play or volume, it counts as well. Starting in insert mode where the site focused a field is correct and is not scored. A check the rig cannot score on a page is left out of the mark, and the note names it. `no default key` means the tool has no key for that action, so the check did not run.

Sites behind a login are `pending H`: the rig cannot log in, so these sites are checked by hand.

## Sites

| Site | DesertFox | Site integration | Vimium | Vimium C | Tridactyl | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube (watch page) | ✅ R | Yes: `src/content/media/`, `src/content/quality/youtube.ts`. A: `test/key/p23_media_keys.mjs` | ✅ R | ✅ R | ✅ R | Play and volume pass for DesertFox. The rivals have no default key for them. |
| Google Sheets (public sheet, view mode) | ✅ R | Yes: row `sheets` in `src/background/default_site_rows.ts`, `src/content/site_actions/`. A: `test/key/p25_site_keys.mjs` | ⚠️ R | ⚠️ R | ⚠️ R | Cell move passes for DesertFox only. The rig does not score activation and scroll on this site. |
| Google Docs (public doc, view mode) | ✅ R H | No: generic code, see [`firefox-behavior.md`](firefox-behavior.md) | ⚠️ R | ❌ R | ⚠️ R | Insert mode on load is correct. The rig does not score activation here. Vimium C does not leave the field. The hand check on 2026-11-13 found scroll, hints and the rest working after `Escape`. |
| Wikipedia | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| GitHub | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| Hacker News | ✅ R | No | ✅ R | ✅ R | ✅ R | The rig does not score activation here: it lands on a link next to the story link. |
| Reddit (logged out) | pending R | No | ✅ R | ✅ R | ✅ R | Retest after the frame focus change. |
| X (logged out) | pending R | No | ✅ R | ✅ R | ✅ R | Retest after the frame focus change. |
| Google Maps | ✅ R | No | ✅ R | ✅ R | ⚠️ R | Tridactyl activation hit the wrong target. Scroll is not scored. |
| Excalidraw | ✅ R | No | ✅ R | ✅ R | ✅ R | Scroll is not scored. |
| StackBlitz | ✅ R | No | ✅ R | ✅ R | ⚠️ R | Tridactyl activation hit the wrong target. Scroll is not scored. |
| Notion (public page) | ✅ R | No | ⚠️ R | ✅ R | ⚠️ R | Scroll is blocked for Vimium and Tridactyl. |
| Google Search | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| Amazon | ⚠️ R | No | ⚠️ R | ⚠️ R | ⚠️ R | Scroll is blocked for DesertFox and Vimium. Vimium C and Tridactyl differ between passes. |
| Stack Overflow | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| MDN | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| Twitch | ✅ R | No | ✅ R | ✅ R | ⚠️ R | Scroll is blocked for Tridactyl. |
| Firefox PDF viewer | ⚠️ R | No | ⚠️ R | ⚠️ R | ⚠️ R | Firefox limit: it runs no extension content script in its PDF viewer, so hints do not work for any tool. Scroll works through the viewer's own `j`. Sources: [`design.md`](design.md) and "Keys in PDF files" in [`firefox-behavior.md`](firefox-behavior.md). |
| YouTube video embedded in another site | ✅ R | Yes: the YouTube media code | ✅ R | ✅ R | ⚠️ R | The rig loads the live player into a local fixture page. Hint and activation checks target the link beside the player. Tridactyl shows no hints there. |
| Google Drive (login) | pending H | No | pending H | pending H | pending H | S: Vimium has hint rules for Drive and the Docs file list, and no key rules. |
| Gmail (login) | pending H | No | pending H | pending H | pending H | |
| Figma (login) | pending H | No | pending H | pending H | pending H | Also check that Figma's own single-letter keys still work on the canvas. |
| Slack or Discord (login) | pending H | No | pending H | pending H | pending H | |
| Outlook or Microsoft 365 (login) | pending H | No | pending H | pending H | pending H | |
| ChatGPT or Claude web (login) | pending H | No | pending H | pending H | pending H | |

## Source checks of the rivals

These are code reads, not runs. The full text is in "Table rows from source" in [`tools/measure/rivals/README.md`](../tools/measure/rivals/README.md).

- Vimium has hint rules for Google Drive and the Docs file list and no per-site key rules. DesertFox ships one key integration, Google Sheets.
- Vimium C has no per-site rule table.
- Tridactyl treats `role=application` elements, which Google Sheets uses, as handling their own keys and stops capturing there. The rule is generic, with no `hjkl` and no clipboard keys.
