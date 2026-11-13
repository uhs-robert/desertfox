# Hand checks on login sites

The rig (`PAGES=sites`) cannot log in, so these sites are checked by hand. Fill in one table per site. Each cell takes `pass`, `fail` or `n/a`, plus a short reason for a fail.

## Setup

- Use a fresh Firefox profile per extension, with only that extension installed. Log in to each site in that profile.
- Install the same builds as the rig: DesertFox from `dist/` after `just build`, the rivals from the pinned xpis in `tools.mjs`. A rig run leaves them in `$MEASURE_DIR/rivals/xpi/`. Load each through `about:debugging`, "Load Temporary Add-on".
- Keep each extension's default settings and keys:

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Scroll | `j` | `j` | `j` | `j` |
| Hints | `f` | `f` | `f` | `f` |
| Leave hints | `Escape` | `Escape` | `Escape` | `Escape` |

## The checks

Run them in this order on each site, with the focus on the page and not in a text field.

1. Scroll: `j` scrolls the main view, the message list or the document.
2. Hints: `f` puts labels on the visible links and buttons.
3. Activate: typing one label clicks or focuses its target.
4. Escape: `Escape` removes every label.
5. Site check: the extra row under each site.

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
| Scroll | | | | |
| Hints | | | | |
| Activate | | | | |
| Escape | | | | |
| A hint on a file row opens the file | | | | |

## Gmail

URL: `https://mail.google.com/mail/u/0/#inbox`

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Scroll | | | | |
| Hints | | | | |
| Activate | | | | |
| Escape | | | | |
| A hint on a message row opens the message | | | | |

## Figma

URL: a design file you own, `https://www.figma.com/design/...`

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Scroll | | | | |
| Hints | | | | |
| Activate | | | | |
| Escape | | | | |
| Figma's own single-letter keys still work on the canvas | | | | |

## Slack or Discord

Site checked (Slack or Discord):

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Scroll | | | | |
| Hints | | | | |
| Activate | | | | |
| Escape | | | | |
| Typing in the message box sends no key to the extension | | | | |

## Outlook or Microsoft 365

Site checked (Outlook or Microsoft 365):

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Scroll | | | | |
| Hints | | | | |
| Activate | | | | |
| Escape | | | | |
| A hint on a message row opens the message | | | | |

## ChatGPT or Claude web

Site checked (ChatGPT or Claude web):

| Check | DesertFox | Vimium | Vimium C | Tridactyl |
| --- | --- | --- | --- | --- |
| Scroll | | | | |
| Hints | | | | |
| Activate | | | | |
| Escape | | | | |
| Typing in the prompt box sends no key to the extension | | | | |
