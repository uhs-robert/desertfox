# Item mode

Item mode walks a page one item at a time. A search result, a story, a file or a comment is an item. In item mode `j` and `k` move to the next and previous item, DesertFox draws a box around it, and `Enter` opens its link.

A list is a run of items that look alike, such as the results of a search or the stories on a front page. A grid of tiles counts too. Every key below is in [docs/keymap.md](keymap.md#item).

## Start and stop

Press `I` in normal mode. DesertFox puts a hint on each list or grid on the page. Type the hint of the one you want to walk, and item mode starts on it. With one list on the page, `I` picks it at once. With none, it shows a notice and stays in normal mode.

Press `I` in item mode to pick another list. Press `Escape` to go back to normal mode.

On some sites item mode starts by itself when the page loads. See [Pages that start in item mode](#pages-that-start-in-item-mode).

Item mode stays on when you follow a link or send a form in the same tab (`Enter` on an item, `]]`, `f`) and the new page has a list. A reload, Back, Forward or an address you type ends it, and so does a site rule with `item_navigator = false`.

## Move

| Key | What it does |
| --- | --- |
| `j` | Next item |
| `k` | Previous item |
| `h` | Item to the left (in a grid, on a list it scrolls left) |
| `l` | Item to the right (in a grid, on a list it scrolls right) |
| `gg` | First item |
| `G` | Last item |
| `}` | First item of the next section |
| `{` | Start of the current section, then the previous section |
| `zt` `zz` `zb` | Scroll back to the current item, at the top, in the middle or at the bottom |

A count repeats a move, as in normal mode. The first press moves to an item that is in view. When none shows, the key scrolls instead. On a page with no list, `j`, `k`, `h`, `l`, `gg` and `G` scroll as they do in normal mode. `}` and `{` show a notice when the page has no sections.

## Act on an item

| Key | What it does |
| --- | --- |
| `Enter` | Open the item's link, or click the element that `Tab` focused |
| `Space` | Click the item's checkbox |
| `Tab` `Shift-Tab` | Focus the next or previous element inside the item |

`Tab` and `Shift-Tab` step through the links, buttons, fields and checkboxes of the item that show (the item itself too when it can take focus), and wrap at the item's edges, so the focus stays in the item. An item whose only focusable element is its link has nothing to step through, so the keys move on through the page's focusable elements from the focus, as the browser's `Tab` does. `Tab` skips text fields, because focusing one starts insert mode and that ends item mode. Checkboxes, radio buttons, buttons, links and selects stay in the ring. `j`, `k` and the other moves land the focus on the new item's link, so the next `Tab` starts there. `Enter` clicks the element only while `Tab` has left the focus on it. After a click, `Space` or any other focus it opens the item's link as before. Each key shows a notice when the item has no link, no checkbox or nothing to focus.

The hint keys work in item mode. `f`, `F` and the `;` group label the whole page and give the shortest hints to the current item, so a page with many links stays quick to use. In normal mode the hints keep their usual order.

Many keys of normal mode keep working in item mode, for example `H` and `L` for history, `]]` and `[[` for next and previous page, `J` and `K` for tabs, `<C-d>` and `<C-u>` to scroll, `/` to find and `:` for the command line. The media keys work too: `am`, `aa` and the rest of the `a` group, `n`, `N`, `*` and `#` for find, and `<C-v>`. `A`, `i`, `v`, `V`, `gV` and the ignore keys start another mode and so leave item mode. `Escape` in media mode that began in item mode goes back to item mode in every frame of the tab. A fullscreen started in item mode starts media mode, and its end goes to normal mode. The list is not complete. `gi` focuses a field and so leaves item mode. A key that item mode does not bind goes to the page.

## Comments on Hacker News and Reddit

On a Hacker News page with comments and on a Reddit comment page (`/r/*/comments/*`), `j` and `k` walk the comments in page order. These keys follow the thread:

| Key | What it does |
| --- | --- |
| `h` | Go to the parent comment |
| `l` | Go to the first reply, or unfold a folded comment |
| `}` | Next sibling comment |
| `{` | Previous sibling comment |
| `za` | Fold or unfold the comment |
| `zc` | Fold the thread, or the parent when the comment has no replies |
| `zo` | Unfold the comment |

On a page with no comment, `h`, `l`, `}` and `{` do what they do on any other list.

On Reddit the item is the author line of a comment. When a comment is longer than the window, `j` still moves on to the next author line, so scroll with `<C-d>` to read the rest. Replies that Reddit has not loaded are not items. Reddit comment pages do not start in item mode, so press `I`.

## Pages that start in item mode

The `item_navigator` setting decides which pages start in item mode when they load:

| Value | Pages that start |
| --- | --- |
| `shipped` | The sites whose shipped row starts item mode (the default) |
| `true` | Every page with a list |
| `false` | None |

Set it with `:set item_navigator true`. A site rule can set it for one site:

```toml
[[site_rules]]
site = "*://example.com/*"
item_navigator = false
```

A page does not start in item mode after you have pressed a key or clicked in it. With any value you can still press `I`.

## Site rows

A site row gives one site its own item keys. The shipped rows cover result lists on Google, DuckDuckGo, Bing and other search sites, Hacker News, Wikipedia, Reddit, Google Drive and more. On those sites `j` and `k` scroll in normal mode and walk the items in item mode. [docs/site_rows.md](site_rows.md) lists every row and its keys, and shows how to write, turn off or override a row.
