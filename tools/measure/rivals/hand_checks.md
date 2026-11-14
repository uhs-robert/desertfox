# Hand checks on login sites

The rig (`PAGES=sites`) cannot log in, so these sites are checked by hand. Fill in one table per site. A step 1 cell takes what you saw. A step 2 cell takes `pass` or `fail`, and a step 3 cell `pass` or `blocked`, plus a short reason when it is not a pass.

## Setup

- Use a fresh Firefox profile per extension, with only that extension installed. Log in to each site in that profile.
- Install the same builds as the rig: DesertFox from `dist/` after `just build`, the rivals from the pinned xpis in `tools.mjs`. A rig run leaves them in `$MEASURE_DIR/rivals/xpi/`. Load each through `about:debugging`, "Load Temporary Add-on".
- Keep each extension's default settings and keys:

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Scroll | `j` | `j` | `j` | `j` |
| Hints | `f` | `f` | `f` | `f` |
| Leave hints, leave a field | `Escape` | `Escape` | `Escape` | `Escape` |

## The checks

Run three steps on each site, the same way the rig does (`sites.mjs`).

1. Mode on load (information, not scored). Load the page and touch nothing. Note where the focus is, also inside a frame, and the extension's mode. DesertFox shows its mode in the badge. For the others, infer the mode: press `j` and see whether it scrolls (normal mode) or types into the field or does nothing (insert mode, or the key went past the extension). Starting in insert mode where the site focused a field is right. Do not reload: steps 2 and 3 follow on the same page, as in the rig (2b is the one exception).
2. Leave (scored). Press the extension's leave key, `Escape` for all four. Pass when the focused element no longer takes typing, in whatever frame it sits: a blur inside the frame passes as well as a move to the page. Fail when the field keeps the focus, or when the extension acts as if in normal mode while its keys still go into the field.
2b. Frame mode (DesertFox only, scored when its badge reads FRAME after step 2). The site dictates focus and DesertFox does not override it: a site that focuses a frame, such as the Google sign-in popup on Reddit and X, leaves DesertFox working inside that frame until the user dismisses it or leaves with `gF`. The other three keep keys on the page, a different design choice, so they have no frame mode and skip this step. Press `gF` first and check that it leaves the frame, because a dismissed popup leaves nothing for `gF`. Do step 3 next, with the popup still up. Last, reload so the frame comes back, and check that `f` shows hints inside it and that a hint can activate a control in it (such as close).
3. Normal-mode actions (scored, pass or blocked). Scroll with `j`. Show hints with `f` on the visible links and buttons. Type one label and check that it clicks or focuses its target or an element inside it, or opens that link's own address. A click on a wrapper around the target does not count. Show hints again and press `Escape`: every label goes. Then the extra row under each site.

## Run details

Fill in once per round of checks.

| Field | Value |
| --- | --- |
| Date | |
| Checked by | |
| Firefox version | |
| DesertFox version and commit | |
| Vimium version | 2.4.2 |
| Vimium C version | 2.12.3 |
| Tridactyl version | 1.25.1 |

## Google Drive

URL: `https://drive.google.com/drive/my-drive`

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| 1. Mode on load (focus, mode) | | | | |
| 2. Leave with `Escape` | | | | |
| 3. Scroll | | | | |
| 3. Hints | | | | |
| 3. Activate | | | | |
| 3. `Escape` out of hints | | | | |
| A hint on a file row opens the file | | | | |

## Gmail

URL: `https://mail.google.com/mail/u/0/#inbox`

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| 1. Mode on load (focus, mode) | | | | |
| 2. Leave with `Escape` | | | | |
| 3. Scroll | | | | |
| 3. Hints | | | | |
| 3. Activate | | | | |
| 3. `Escape` out of hints | | | | |
| A hint on a message row opens the message | | | | |

## Figma

URL: a design file you own, `https://www.figma.com/design/...`

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| 1. Mode on load (focus, mode) | | | | |
| 2. Leave with `Escape` | | | | |
| 3. Scroll | | | | |
| 3. Hints | | | | |
| 3. Activate | | | | |
| 3. `Escape` out of hints | | | | |
| Figma's own single-letter keys still work on the canvas | | | | |

## Slack or Discord

Site checked (Slack or Discord):

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| 1. Mode on load (focus, mode) | | | | |
| 2. Leave with `Escape` | | | | |
| 3. Scroll | | | | |
| 3. Hints | | | | |
| 3. Activate | | | | |
| 3. `Escape` out of hints | | | | |
| Typing in the message box sends no key to the extension | | | | |

## Outlook or Microsoft 365

Site checked (Outlook or Microsoft 365):

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| 1. Mode on load (focus, mode) | | | | |
| 2. Leave with `Escape` | | | | |
| 3. Scroll | | | | |
| 3. Hints | | | | |
| 3. Activate | | | | |
| 3. `Escape` out of hints | | | | |
| A hint on a message row opens the message | | | | |

## ChatGPT or Claude web

Site checked (ChatGPT or Claude web):

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| 1. Mode on load (focus, mode) | | | | |
| 2. Leave with `Escape` | | | | |
| 3. Scroll | | | | |
| 3. Hints | | | | |
| 3. Activate | | | | |
| 3. `Escape` out of hints | | | | |
| Typing in the prompt box sends no key to the extension | | | | |
