# Site compatibility

The sites DesertFox was checked on, what it does there, and how three other keyboard extensions for Firefox do on the same checks. A different design choice is not a defect, and the notes say so where it applies.

## How to read the table

Each result cell is a mark and an evidence tag, such as `✅ R`.

| Mark | Meaning |
| --- | --- |
| ✅ | The site's main tasks work by keyboard alone. |
| ⚠️ | The main tasks work by keyboard, but a step needs one click first, for example into a pane, or movement works only with some keys. The note says which. |
| ❌ | A main task has no lasting key path. Keys stay trapped, or every step needs a click again, or an action such as selecting items has no key. The note says which. |
| n/a | The check does not apply. |
| pending | The check is not done yet. |

| Tag | Meaning |
| --- | --- |
| R | Rig run on the live site. `PAGES=sites PASSES=3 just measure-rivals`, see [`tools/measure/rivals/README.md`](../tools/measure/rivals/README.md). |
| H | Hand check in a real browser session. Steps in [`tools/measure/rivals/hand_checks.md`](../tools/measure/rivals/hand_checks.md). |
| A | Automated test on a local stand-in page, never the live site. |
| S | Source check: the project's code was read, nothing was run. |

All R cells: 2026-11-14, Firefox 160.0 (headless, fresh profile per tool, default keys and settings), DesertFox 0.1.24, Vimium 2.4.2, Vimium C 2.12.3, Tridactyl 1.25.1, three passes per site and tool. A cell shows the result most passes gave. Run 7b covers every site (rig commit `88b037dc`, extension build `eb5086b1`). Run 8b (build `c77c6e05`) reran Reddit and X. The rival Reddit and X cells come from run 8b. A later rerun of Reddit and X on main `0f4b1821` (3 passes, same rival versions) supplies DesertFox's cells on those two rows. The run 7b build predates #656, which affects only the embed `play` result. The H cells come from hand checks. Hand checks on 2026-11-14 covered the three rivals on Sheets (view), and all four tools on Sheets (editing), Docs (view), Docs (editing), Reddit, Google Drive, Gmail, Discord, ChatGPT and Claude web. DesertFox on Docs (view) was also checked on 2026-11-13. The rivals ran the same pinned versions as the R cells. A rig run is a dated snapshot, not a test, because sites change.

A site is scored by whether a keyboard user can get around it with the tool. The three core tasks are: move around the site, open links and controls by hint, and leave a text field. Any keys count, with default settings: the tool's own keys or the site's own keys, with the tool active. A key path counts only if a user can find it without reading the extension's docs. If a main task has no lasting key path, because keys stay trapped or every step needs a click again, the mark is ❌. If the main tasks work but a step needs one click first, or movement works only with some keys, the mark is ⚠️. If the main tasks work by keyboard alone, the mark is ✅.

DesertFox lets a user override key bindings for one site. A `site_rules` row in the user's config matches a site by address pattern and binds keys for it, for example `h` to `page send_key ArrowLeft`. A user can fix a site this way on their own machine. The rows DesertFox ships live in `src/background/default_site_rows.ts`. A pull request that adds a row shares a fix with every user. How to set a row is in [Site table](design.md#site-table).

Site extras that the site's own keys already cover, such as YouTube play and volume, stay out of the mark. Starting in insert mode where the site focused a field is correct and is not scored. A check the rig cannot score on a page is left out of the mark, and the note names it.

The rig cannot log in, so sites behind a login are checked by hand. A login site not yet checked reads `pending H`.

## Sites

| Site | DesertFox | Site integration | Vimium | Vimium C | Tridactyl | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube (watch page) | ✅ R | Yes: `src/content/media/`, `src/content/quality/youtube.ts`. A: `test/key/p23_media_keys.mjs` | ✅ R | ✅ R | ✅ R | Play and volume pass for DesertFox. The rivals have no default key for them. |
| Google Sheets (public sheet, view) | ✅ R | Yes: row `sheets` in `src/background/default_site_rows.ts`, `src/content/site_actions/`. A: `test/key/p25_site_keys.mjs` | ⚠️ R H | ⚠️ R H | ⚠️ R H | `j` and `k` do not move cells. The arrow keys do, while the sheet has focus. The rig does not score activation here. |
| Google Sheets (sheet open for editing) | ✅ H | Yes: row `sheets` in `src/background/default_site_rows.ts`, `src/content/site_actions/`. A: `test/key/p25_site_keys.mjs` | ❌ H | ❌ H | ⚠️ H | DesertFox: every action works from the keyboard. Vimium: after `Escape` no key returns focus to the sheet, and it scrolls left and right only. Vimium C: after `Escape` no key returns focus to the sheet, and it does not scroll. Tridactyl: `gi` focuses the sheet, the arrow keys move and `i` types in a cell, but `Enter` or `Escape` loses the focus, so each move needs `gi` again, and there is no multi-select. |
| Google Docs (public doc, view) | ✅ R H | No: generic code, see [`firefox-behavior.md`](firefox-behavior.md) | ⚠️ R H | ❌ R H | ⚠️ R H | Insert mode on load is correct. Vimium C: keys stay trapped in the document. No tool key works, including tab switching, so only the mouse gets out. The Vimium C release notes (1.75.8) say to press `Escape` "for a while" to move focus out of the document ([release notes](https://github.com/gdh1995/vimium-c/blob/master/RELEASE-NOTES.md)), and issue [#211](https://github.com/gdh1995/vimium-c/issues/211) covers the yellow border. This table does not count it, because a user cannot find it without reading the extension's docs. Vimium and Tridactyl: `j` does not scroll. The arrow keys move through the document. DesertFox: scroll, hints and the rest work after `Escape`. |
| Google Docs (doc open for editing) | ✅ H | No: generic code, see [`firefox-behavior.md`](firefox-behavior.md) | ❌ H | ❌ H | ❌ H | Vimium: after `Escape`, no key puts focus back in the document. Vimium C: stays in insert mode, and no key leaves it. The 1.75.8 release notes say to press `Escape` "for a while", and issue [#211](https://github.com/gdh1995/vimium-c/issues/211) covers the yellow border. This table does not count it, for the same reason. Tridactyl: leaves and re-enters the text, but no key scrolls. Each ❌ needs the mouse to continue. |
| Wikipedia | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| GitHub | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| Hacker News | ✅ R | No | ✅ R | ✅ R | ✅ R | The rig does not score activation here: it lands on a link next to the story link. |
| Reddit (logged out) | ✅ R H | No | ✅ R H | ⚠️ R H | ⚠️ R H S | DesertFox dismisses the Google sign-in popup by keyboard, and its hints reach the popup's buttons. Vimium C: no key reaches the popup, so it cannot be dismissed without the mouse. Tridactyl: while focus is in the sign-in popup, no Tridactyl key works, because it runs only in the top page. `Escape`, the popup's own key, closes it. Signing in needs the mouse. |
| X (logged out) | ✅ R | No | ✅ R | ✅ R | ✅ R | DesertFox hints reach the sign-in popup's buttons, and one hint dismisses it. |
| Google Maps | ✅ R | No | ✅ R | ✅ R | ⚠️ R | Tridactyl activation hit the wrong target. Scroll is not scored. |
| Excalidraw | ✅ R | No | ✅ R | ✅ R | ✅ R | Scroll is not scored. |
| StackBlitz | ✅ R | No | ✅ R | ✅ R | ⚠️ R | Tridactyl activation hit the wrong target. Scroll is not scored. |
| Google Search | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| Amazon | n/a | No | n/a | n/a | n/a | The rig often got Amazon's short interstitial page, so it was not scored. |
| Stack Overflow | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| MDN | ✅ R | No | ✅ R | ✅ R | ✅ R | |
| Firefox PDF viewer | n/a | No | n/a | n/a | n/a | Firefox limit: it runs no extension content script in its PDF viewer, so hints do not work for any tool. Scroll works through the viewer's own `j`. Sources: [`design.md`](design.md) and "Keys in PDF files" in [`firefox-behavior.md`](firefox-behavior.md). |
| YouTube video embedded in another site | ✅ R | Yes: the YouTube media code | ✅ R | ✅ R | ✅ R | The rig loads the live player into a local fixture page. Hint and activation checks target the link beside the player. The rig found no hints for Tridactyl there, so its hints and activation are not scored. |
| Google Drive (login) | ✅ H | No | ❌ H | ✅ H | ✅ H | Vimium: cannot select items to act on. Source check: Vimium has hint rules for Drive and the Docs file list, and no key rules. |
| Gmail (login) | ✅ H | No | ❌ H | ❌ H | ✅ H | Vimium and Vimium C: no key works in Gmail. Vimium excludes `mail.google.com` by default ([`lib/settings.js`, v2.4.2](https://github.com/philc/vimium/blob/v2.4.2/lib/settings.js#L42)). Its documented fix is a pass-keys rule in its settings, which this table does not count because it scores default settings ([Disabling Vimium](https://github.com/philc/vimium/wiki/Disabling-Vimium)). |
| Figma (login) | pending H | No | pending H | pending H | pending H | Also check that Figma's own single-letter keys still work on the canvas. |
| Slack (login) | pending H | No | pending H | pending H | pending H | |
| Discord (login) | ✅ H | No | ⚠️ H | ✅ H | ✅ H | Vimium: hints miss the channel list, so choosing a channel needs a click. |
| ChatGPT (login) | ✅ H | No | ⚠️ H | ⚠️ H | ⚠️ H | Only DesertFox focuses and scrolls the side panel and the chat by keyboard, with no click. The others scroll a pane once a click puts focus in it, so they need one click per pane. |
| Claude web (login) | ✅ H | No | ⚠️ H | ⚠️ H | ⚠️ H | Only DesertFox focuses and scrolls the side panel and the chat by keyboard, with no click. The others scroll a pane once a click puts focus in it, so they need one click per pane. |

## Source checks of the rivals

These are code reads, not runs. The full text is in "Table rows from source" in [`tools/measure/rivals/README.md`](../tools/measure/rivals/README.md).

- Vimium has hint rules for Google Drive and the Docs file list and no per-site key rules. DesertFox ships one key integration, Google Sheets.
- Vimium C has no per-site rule table.
- Tridactyl treats `role=application` elements, which Google Sheets uses, as handling their own keys and stops capturing there. The rule is generic, with no `hjkl` and no clipboard keys.
- Tridactyl 1.25.1's manifest sets no `all_frames`, so its script loads in the top page only and no key works while focus is in a frame. Its hints skip frames from other sites: `getAllDocumentFrames` and `getElemsBySelector` in [`src/lib/dom.ts`](https://github.com/tridactyl/tridactyl/blob/1.25.1/src/lib/dom.ts) read each iframe's `contentDocument` and drop the frame when that read fails, and `:hint -c` uses the same function.
