# Site rows

DesertFox ships site rows: keys and a few page settings for sites that need them. Each row has a name and the addresses it covers. The tables list the keys each row gives, with the guard that limits a key, and the notes list the page settings a row changes. A key listed under a row does that on those sites in place of its usual action. Open the Site Rules view on the help page to see the rows that fit the page you are on.

An item is one entry of a list: a search result, a story, a file or an image tile. DesertFox draws a box around the item it moves to, and Enter opens its link.

Generated from `src/background/default_site_rows.ts`. Do not edit between the markers. Run `just docs-gen` after a change to it. `just test` fails when the tables are stale.

<!-- BEGIN generated -->

Shipped rows: 29 (`sheets`, `maps`, `arrow`, `google_images`, `google_videos`, `google_news`, `google_short_videos`, `google_shopping`, `ddg_images`, `ddg_videos`, `ddg_news`, `ddg`, `kagi_images`, `kagi`, `brave_images`, `brave`, `google`, `bing`, `hackernews`, `wikipedia`, `lobsters`, `archwiki`, `startpage`, `arxiv`, `stackoverflow`, `tildes`, `amazon`, `reddit`, `drive`).

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
| `G` | Go to column A of the last row with data |

- Escape goes to the page, so Sheets cancels a cell edit. In a plain text box Escape does nothing and insert mode stays. Insert mode entered with the insert key while no text box has focus still ends on Escape.
- `#waffle-rich-text-editor` does not count as a text box while it has no width.

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
| `G` | Extend the selection to the last row with data |
| `x` | End the mode, then cut in the page |
| `y` | End the mode, then copy in the page |
| `p` | End the mode, then paste in the page |

### `maps`

Addresses: `https://www.google.com/maps*`, `https://google.com/maps*`

| Key | What it does |
| --- | --- |
| `h` | Press ArrowLeft in the page (only while nothing has focus or the focus is on the part this row names) |
| `j` | Press ArrowDown in the page (only while nothing has focus or the focus is on the part this row names) |
| `k` | Press ArrowUp in the page (only while nothing has focus or the focus is on the part this row names) |
| `l` | Press ArrowRight in the page (only while nothing has focus or the focus is on the part this row names) |

- When the page loads, the cursor goes to the first match of `div[role="application"][tabindex="0"]`, in place of a text box.

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

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `google_videos`

Addresses: `https://www.google.com/search*udm=7&*`, `https://www.google.com/search*udm=7`, `https://www.google.com/search*udm=vids&*`, `https://www.google.com/search*udm=vids`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `google_news`

Addresses: `https://www.google.com/search*tbm=nws&*`, `https://www.google.com/search*tbm=nws`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `google_short_videos`

Addresses: `https://www.google.com/search*udm=short_vids&*`, `https://www.google.com/search*udm=short_vids`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `google_shopping`

Addresses: `https://www.google.com/search*udm=28&*`, `https://www.google.com/search*udm=28`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `ddg_images`

Addresses: `https://duckduckgo.com/?*iax=images*`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `ddg_videos`

Addresses: `https://duckduckgo.com/?*iax=videos*`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `ddg_news`

Addresses: `https://duckduckgo.com/?*iar=news*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `ddg`

Addresses: `https://duckduckgo.com/?*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `kagi_images`

Addresses: `https://kagi.com/images*`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `kagi`

Addresses: `https://kagi.com/search*`

Keys left to the page: `j` `k`.

### `brave_images`

Addresses: `https://search.brave.com/images*`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `brave`

Addresses: `https://search.brave.com/search*`

| Key | What it does |
| --- | --- |
| `j` | Press ArrowDown in the page |
| `k` | Press ArrowUp in the page |

### `google`

Addresses: `https://www.google.com/search*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `bing`

Addresses: `https://www.bing.com/search*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `hackernews`

Addresses: `https://news.ycombinator.com/*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |
| `h` | Go to the parent comment |
| `l` | Go to the first reply, or unfold a folded comment |
| `}` | Go to the next sibling comment |
| `{` | Go to the previous sibling comment |
| `za` | Fold or unfold the comment |
| `zc` | Fold the thread, or the parent of a comment with no replies |
| `zo` | Unfold the comment |

### `wikipedia`

Addresses: `https://*.wikipedia.org/w/index.php?*search=*`, `https://*.wikipedia.org/wiki/Special:Search*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `lobsters`

Addresses: `https://lobste.rs/`, `https://lobste.rs/newest*`, `https://lobste.rs/active*`, `https://lobste.rs/t/*`, `https://lobste.rs/page/*`, `https://lobste.rs/recent*`, `https://lobste.rs/top*`, `https://lobste.rs/domains/*`, `https://lobste.rs/search*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `archwiki`

Addresses: `https://wiki.archlinux.org/index.php?*search=*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `startpage`

Addresses: `https://www.startpage.com/sp/search*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `arxiv`

Addresses: `https://arxiv.org/search/*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `stackoverflow`

Addresses: `https://stackoverflow.com/questions*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `tildes`

Addresses: `https://tildes.net/*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `amazon`

Addresses: `https://www.amazon.com/s?*`, `https://www.amazon.com/s/*`

In item mode:

| Key | What it does |
| --- | --- |
| `h` | Go to item on the left |
| `j` | Go to item below |
| `k` | Go to item above |
| `l` | Go to item on the right |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |

### `reddit`

Addresses: `https://www.reddit.com/*`, `https://reddit.com/*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Go to item below |
| `k` | Go to item above |
| `G` | Go to last item (scrolls the page when no item shows) |

### `drive`

Addresses: `https://drive.google.com/drive/*`

In item mode:

| Key | What it does |
| --- | --- |
| `j` | Move to the file below (scrolls the page when no file shows) |
| `k` | Move to the file above (scrolls the page when no file shows) |
| `gg` | Go to first item (scrolls the page when no item shows) |
| `G` | Go to last item (scrolls the page when no item shows) |
| `h` | Move to the file on the left (scrolls sideways in the list view) |
| `l` | Move to the file on the right (scrolls sideways in the list view) |
| `<Enter>` | Open the selected file |

- Item moves select the file with Drive's own arrow keys: j, k, h and l send the arrow. gg and G go to the end and then send an arrow pair that comes back to it, so Enter opens that file. In a folder with one file, or one row of tiles, no arrow can move and the file stays unselected.

<!-- END generated -->

## Write your own rule

Add a `[[site_rules]]` table to your settings file for each site you want to change. The `site` field is a web address where `*` stands for any text. The rest sets what DesertFox does there:

```toml
[[site_rules]]
site = "*://*.example.com/*"
off = true            # turn every DesertFox key off on these sites

[[site_rules]]
site = "*://mail.example.org/*"
pass = "j k"          # give these keys to the page

[[site_rules]]
site = "*://docs.example.org/*"
only = "G"            # keep only these keys on
```

A rule can set `pass` or `only`, not both. A rule with nothing but `site` turns the keys off. For each field, the first rule that matches the page and sets that field decides. Rules add up across files: the rows of `settings.toml` come first, then each file of `settings.d` in name order, then the shipped rows. The earlier row wins, which is the reverse of a plain setting, where the later file wins. Put a row that must win in `settings.toml` or in an earlier-named file. Edit the file, then run `config.reload`, or edit the same text in Settings under Advanced. The Your site rules section of Settings lists what each rule does. The Override a row section below covers `bind` and the rest.

## Turn a row off

The `default_site_rows_off` setting holds the whole list, so `:set` replaces it. List every row to turn off. For example, `:set default_site_rows_off drive maps` turns off Drive and Maps, and turns every other row back on. The setting turns off every row of that name, so `sheets` covers both Sheets address forms. The names are the headings above.

## Override a row

A `site_rules` row of your own wins over a shipped row. For each setting, the first row that matches the page and sets it decides, and your rows come before the shipped ones. A `bind` table merges key by key, so your row can change one key and keep the rest. A row that sets `pass` or `only` replaces the shipped `pass` for that page.
