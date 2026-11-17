# Site rows

DesertFox ships site rows: keys and settings for sites that need them. Each row has a name and the addresses it covers. The tables list what each row gives. A key listed under a row does that on those sites in place of its usual action. Open the Site Rules view on the help page to see the rows that fit the page you are on.

An item is one entry of a list: a search result, a story, a file or an image tile. DesertFox draws a box around the item it moves to, and Enter opens its link.

Generated from `src/background/default_site_rows.ts`. Do not edit between the markers. Run `just docs-gen` after a change to it. `just test` fails when the tables are stale.

<!-- BEGIN generated -->

Shipped rows: 19 (`sheets`, `maps`, `arrow`, `google_images`, `ddg_images`, `ddg`, `kagi`, `brave`, `google`, `bing`, `hackernews`, `wikipedia`, `lobsters`, `archwiki`, `startpage`, `arxiv`, `stackoverflow`, `tildes`, `drive`).

### `sheets`

Addresses: `https://docs.google.com/spreadsheets/*`, `https://docs.google.com/a/*/spreadsheets/*`

| Key | What it does |
| --- | --- |
| `h` | Press ArrowLeft in the page |
| `j` | Press ArrowDown in the page |
| `k` | Press ArrowUp in the page |
| `l` | Press ArrowRight in the page |
| `gg` | Press Ctrl+Home in the page |
| `<C-h>` | Press Ctrl+ArrowLeft in the page |
| `<C-j>` | Press Ctrl+ArrowDown in the page |
| `<C-k>` | Press Ctrl+ArrowUp in the page |
| `<C-l>` | Press Ctrl+ArrowRight in the page |
| `x` | Cut in the page |
| `p` | Paste in the page |
| `y` | Copy in the page |
| `v` | Start the visual mode |
| `V` | Start the visual mode |
| `G` | Go to column A of the last row with data, then press Home in the page |

Keys left to the page: `<C-a>` `<C-x>` `<C-v>`.

#### Mode VISUAL

Start it with `v` or `V`.

| Key | What it does |
| --- | --- |
| `h` | Press Shift+ArrowLeft in the page |
| `j` | Press Shift+ArrowDown in the page |
| `k` | Press Shift+ArrowUp in the page |
| `l` | Press Shift+ArrowRight in the page |
| `gg` | Press Ctrl+Shift+Home in the page |
| `<C-h>` | Press Ctrl+Shift+ArrowLeft in the page |
| `<C-j>` | Press Ctrl+Shift+ArrowDown in the page |
| `<C-k>` | Press Ctrl+Shift+ArrowUp in the page |
| `<C-l>` | Press Ctrl+Shift+ArrowRight in the page |
| `G` | Extend the selection to the last row with data, then press Shift+Home in the page |
| `x` | End the mode, then cut in the page |
| `y` | End the mode, then copy in the page |
| `p` | End the mode, then paste in the page |

### `maps`

Addresses: `https://www.google.com/maps*`, `https://google.com/maps*`

| Key | What it does |
| --- | --- |
| `h` | Press ArrowLeft in the page |
| `j` | Press ArrowDown in the page |
| `k` | Press ArrowUp in the page |
| `l` | Press ArrowRight in the page |

### `arrow`

Addresses: `<all_urls>`

#### Mode ARROW

Start it with `<A-l>`.

| Key | What it does |
| --- | --- |
| `h` | Press the left arrow on the focused control |
| `j` | Press the down arrow on the focused control |
| `k` | Press the up arrow on the focused control |
| `l` | Press the right arrow on the focused control |
| `<Escape>` | End the mode, then press Escape in the page |

### `google_images`

Addresses: `https://www.google.com/search*udm=2&*`, `https://www.google.com/search*udm=2`

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `ddg_images`

Addresses: `https://duckduckgo.com/?*iax=images*`

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `ddg`

Addresses: `https://duckduckgo.com/?*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `kagi`

Addresses: `https://kagi.com/search*`

Keys left to the page: `j` `k`.

### `brave`

Addresses: `https://search.brave.com/search*`

| Key | What it does |
| --- | --- |
| `j` | Press ArrowDown in the page |
| `k` | Press ArrowUp in the page |

### `google`

Addresses: `https://www.google.com/search*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `bing`

Addresses: `https://www.bing.com/search*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `hackernews`

Addresses: `https://news.ycombinator.com/*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `wikipedia`

Addresses: `https://*.wikipedia.org/w/index.php?*search=*`, `https://*.wikipedia.org/wiki/Special:Search*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `lobsters`

Addresses: `https://lobste.rs/`, `https://lobste.rs/newest*`, `https://lobste.rs/active*`, `https://lobste.rs/t/*`, `https://lobste.rs/page/*`, `https://lobste.rs/recent*`, `https://lobste.rs/top*`, `https://lobste.rs/domains/*`, `https://lobste.rs/search*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `archwiki`

Addresses: `https://wiki.archlinux.org/index.php?*search=*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `startpage`

Addresses: `https://www.startpage.com/sp/search*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `arxiv`

Addresses: `https://arxiv.org/search/*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `stackoverflow`

Addresses: `https://stackoverflow.com/questions*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `tildes`

Addresses: `https://tildes.net/*`

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |

### `drive`

Addresses: `https://drive.google.com/drive/*`

| Key | What it does |
| --- | --- |
| `j` | Go to the current item, then press ArrowDown in the page (the plain key on a page with no item) |
| `k` | Go to the current item, then press ArrowUp in the page (the plain key on a page with no item) |
| `gg` | Go to first item (the plain key on a page with no item) |
| `G` | Go to last item (the plain key on a page with no item) |
| `h` | Go to the current item, then press ArrowLeft in the page (the plain key on a page with no item) |
| `l` | Go to the current item, then press ArrowRight in the page (the plain key on a page with no item) |

<!-- END generated -->

## Turn a row off

Add the row name to the `default_site_rows_off` setting. For example, `:set default_site_rows_off drive` turns the Drive row off. The setting turns off every row of that name, so `sheets` covers both Sheets address forms. The names are the headings above.

## Override a row

A `site_rules` row of your own wins over a shipped row. For each setting, the first row that matches the page and sets it decides, and your rows come before the shipped ones. A `bind` table merges key by key, so your row can change one key and keep the rest. A row that sets `pass` or `only` replaces the shipped `pass` for that page.
