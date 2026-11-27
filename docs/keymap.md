# Binding map

The default keymap, generated from `src/shared/keys/default_keymap.ts`. Do not edit between the markers. Run `just docs-gen` after a change to it. `npm test` fails when the tables are stale.

Search engine keys (`s`, `S`, `,`) and container keys (`c`, `C`) come from the user's config, so no row lists them. The config generates them from `search_keys` and `container_keys`. One default is left unbound on purpose. `ZZ` closes every window with no undo, so users bind it in their config.

Which-key shows a group as `+Name`, for example `g` as `+Go`. A `group_names` section in `keymap.toml` maps a key sequence to its name. A group without one shows its prefix key.

A key shows the command label plus a phrase for each arg its binding sets, for example `gO` as "Open URL in new tab". Keys that set numbers carry a `label` in the default keymap, such as `h` as "Scroll left". The Label column shows that `label` or the command label. The rule is in [design/interfaces_pages.md](design/interfaces_pages.md#which-key).

The hint keys `;r ;B ;n ;d ;o ;h ;x ;2 ;g ;G` are modifiers, so no row lists their variants. A `[modifiers]` section in `keymap.toml` holds them. Each adds its args to a variant of every key in the `;` group: `;Bl` opens a link in a background tab, `;oa` selects any visible element in the DevTools Inspector, `;ha` hovers any element, `;2a` double-clicks any element but a link, `;xa` deletes any element, `;rl` opens links in background tabs and keeps picking. A variant exists only when the `hint` param schema accepts the combination. Keys that set their own `action` (`;s`, `;v`, `;V` and the `;y` yank keys) get none, and modifiers do not stack.

A register prefix `"<reg>` and a count go before any command in normal, caret, visual and visual line mode, so `"ay` yanks into register `a` and `"app` opens it. The prefix is no row below, because it is no key of the tree. In insert mode `<C-r><reg>` pastes a register.

The `caret`, `visual` and `cmdline` rows bind placeholder commands that refuse until their piece builds them.

The Locked pages column of the normal table marks the keys that also work on pages DesertFox cannot reach, such as about:addons, when the browser module is installed. A key that prompts there opens the address bar with `df ` and the command typed in. The column comes from the same derivation as the module's key tree (`src/shared/browser_module_scope.ts`).

A note "(prompts)" means the binding sets a `prompt` for a param, so the command line asks for it.

<!-- BEGIN generated -->

bound: 533 (normal 280, media 26, item 26, item_visual 18, grab 11, sidebar 10, hint 8, cmdline 19, caret 36, visual 44, visual_line 45, insert 5, ignore 1, browser 4)

### normal

| Key | Command | Label | Locked pages |
| --- | --- | --- | --- |
| `h` | `scroll.pixels --dx=-50` | Scroll left | yes |
| `l` | `scroll.pixels --dx=50` | Scroll right | yes |
| `j` | `scroll 10` | Scroll down | yes |
| `k` | `scroll -10` | Scroll up | yes |
| `gg` | `scroll.to 0` | Scroll to top | yes |
| `G` | `scroll.to 100` | Scroll to bottom | yes |
| `$` | `scroll.to --x 100` | Scroll to right edge | yes |
| `^` | `scroll.to --x 0` | Scroll to left edge | yes |
| `<C-d>` | `scroll.pages --fraction=0.5` | Scroll half page down | yes |
| `<C-u>` | `scroll.pages --fraction=-0.5` | Scroll half page up | yes |
| `<C-f>` | `scroll.pages` | Scroll page down | yes |
| `<C-b>` | `scroll.pages --fraction=-1` | Scroll page up | yes |
| `H` | `page.back` | Back | yes |
| `L` | `page.forward` | Forward | yes |
| `<C-o>` | `page.jump --older` | Jump back |  |
| `<C-i>` | `page.jump --newer` | Jump forward |  |
| `rr` | `page.reload` | Reload | yes |
| `rh` | `page.reload --hard` | Hard reload | yes |
| `R` | `page.reload --hard` | Hard reload | yes |
| `rc` | `page.reload --site` | Clear site data, reload | yes |
| `rC` | `page.reload --all` (prompts) | Clear all data, reload | yes |
| `xp` | `page.stop` | Stop loading |  |
| `gh` | `page.home` | Home page | yes |
| `gH` | `page.home --tab` | Home page | yes |
| `]]` | `page.follow --next` | Next page |  |
| `[[` | `page.follow --prev` | Previous page |  |
| `]i` | `page.focus_field --next` | Next form control |  |
| `[i` | `page.focus_field --prev` | Previous form control |  |
| `]h` | `page.heading --next` | Next heading |  |
| `[h` | `page.heading --prev` | Previous heading |  |
| `}` | `page.heading --next-block` | Next paragraph |  |
| `{` | `page.heading --prev-block` | Previous paragraph |  |
| `]H` | `page.heading --last` | Last heading |  |
| `[H` | `page.heading --first` | First heading |  |
| `]'` | `mark.step --next` | Next mark |  |
| `['` | `mark.step --prev` | Previous mark |  |
| `]l` | `page.focus_link --next` | Next link |  |
| `[l` | `page.focus_link --prev` | Previous link |  |
| `]g` | `tabgroup.next` | Next tab group | yes |
| `[g` | `tabgroup.prev` | Previous tab group | yes |
| `]t` | `tab.next` | Next tab | yes |
| `[t` | `tab.prev` | Previous tab | yes |
| `]T` | `tab.goto -1` | Last tab | yes |
| `[T` | `tab.goto 1` | First tab | yes |
| `]j` | `page.jump --newer` | Jump forward |  |
| `[j` | `page.jump --older` | Jump back |  |
| `]v` | `media skip next` | Next video |  |
| `[v` | `media skip previous` | Previous video |  |
| `sh` | `cmdline.open --text='heading '` | Search headings |  |
| `.` | `repeat` | Repeat | yes |
| `J` | `tab.next` | Next tab | yes |
| `K` | `tab.prev` | Previous tab | yes |
| `gt` | `tab.goto` | Next tab | yes |
| `gT` | `tab.prev` | Previous tab | yes |
| `ga` | `tab.goto_audible` | Go to audible tab | yes |
| `gl` | `tab.alternate` | Last used tab | yes |
| `gL` | `tab.alternate_any_window` | Last used tab, any window | yes |
| `gp` | `tab.split_other` | Other pane | yes |
| `gP` | `tab.split_swap` | Swap panes | yes |
| `Ep` | `tab.split_other` | Other pane | yes |
| `Es` | `tab.split_swap` | Swap panes | yes |
| `En` | `pane.split` | Split view | yes |
| `EN` | `pane.split --next` | Split view | yes |
| `Eu` | `pane.unsplit` | Unsplit | yes |
| `Ex` | `pane.close_both` | Close both panes | yes |
| `E<` | `pane.resize --narrow` | Resize pane | yes |
| `E>` | `pane.resize` | Resize pane | yes |
| `E=` | `pane.equalize` | Equal panes | yes |
| `Eh` | `pane.focus_side left` | Focus left or right | yes |
| `El` | `pane.focus_side right` | Focus left or right | yes |
| `Ej` | `pane.focus devtools` | Focus region | yes |
| `Ek` | `pane.focus page` | Focus region | yes |
| `ES` | `pane.focus sidebar` | Focus region | yes |
| `ED` | `pane.focus devtools` | Focus region | yes |
| `gF` | `frame.exit` | Focus top page |  |
| `g0` | `tab.goto 1` | First tab | yes |
| `g$` | `tab.goto -1` | Last tab | yes |
| `T` | `tab` (prompts) | Switch tab | yes |
| `<<` | `tab.move --offset=-1` | Move tab left | yes |
| `>>` | `tab.move --offset=1` | Move tab right | yes |
| `xx` | `tab.close` | Close tab | yes |
| `dd` | `tab.close` | Close tab | yes |
| `D` | `tab.close --focus-previous` | Close tab | yes |
| `dL` | `tab.close --all-after` | Close tabs after this one | yes |
| `dH` | `tab.close --all-before` | Close tabs before this one | yes |
| `gx0` | `tab.close --all-before` | Close tabs before this one | yes |
| `gx$` | `tab.close --all-after` | Close tabs after this one | yes |
| `u` | `tab.undo_close` | Reopen closed tab | yes |
| `<A-p>` | `tab.pin` | Toggle pin | yes |
| `<A-m>` | `tab.mute` | Toggle mute | yes |
| `am` | `tab.mute` | Toggle mute | yes |
| `aa` | `media enter` | Start media mode |  |
| `ap` | `media play_pause` | Play or pause |  |
| `as` | `media speed up` | Speed up |  |
| `aS` | `media speed down` | Slow down |  |
| `ar` | `media speed reset` | Reset speed |  |
| `av` | `media volume up` | Volume up |  |
| `aV` | `media volume down` | Volume down |  |
| `al` | `media seek up` | Seek forward |  |
| `ah` | `media seek down` | Seek back |  |
| `aP` | `media pip` | Toggle picture-in-picture |  |
| `af` | `media fullscreen` | Toggle fullscreen |  |
| `A` | `cmdline.open --text='media '` | Media command |  |
| `tt` | `open --tab` (prompts) | Open URL | yes |
| `tT` | `tab` (prompts) | Switch tab | yes |
| `ts` | `session.save` (prompts) | Save tab session | yes |
| `tS` | `session.open` (prompts) | Open tab session | yes |
| `td` | `tab.duplicate` | Duplicate tab | yes |
| `tm` | `tab.move` (prompts) | Move tab | yes |
| `tM` | `cmdline.open --text='tab.move --offset='` | Move tab by an offset |  |
| `tn` | `tab.next` | Next tab | yes |
| `tp` | `tab.prev` | Previous tab | yes |
| `ta` | `tab.goto_audible` | Go to audible tab | yes |
| `t0` | `tab.goto 1` | First tab | yes |
| `t$` | `tab.goto -1` | Last tab | yes |
| `tl` | `tab.alternate` | Last used tab | yes |
| `tL` | `tab.alternate_any_window` | Last used tab, any window | yes |
| `tuu` | `tab.unload` | Unload tab | yes |
| `tuh` | `tab.unload --all-before` | Unload tabs before this one | yes |
| `tul` | `tab.unload --all-after` | Unload tabs after this one | yes |
| `tUh` | `tab.load --all-before` | Load tabs before this one | yes |
| `tUl` | `tab.load --all-after` | Load tabs after this one | yes |
| `tga` | `tabgroup.add` (prompts) | Add tab to a group | yes |
| `tgA` | `tabgroup.add` | Add tab to a new group | yes |
| `tgd` | `tabgroup.remove` | Remove tab from group | yes |
| `tgD` | `tabgroup.close` | Close tab group | yes |
| `tgn` | `tabgroup.name` (prompts) | Name tab group | yes |
| `tgc` | `tabgroup.collapse` | Collapse tab group | yes |
| `tge` | `tabgroup.expand` | Expand tab group | yes |
| `tgt` | `tabgroup.toggle` | Toggle tab group | yes |
| `tgl` | `tabgroup.color` (prompts) | Color tab group | yes |
| `tgj` | `tabgroup.next` | Next tab group | yes |
| `tgk` | `tabgroup.prev` | Previous tab group | yes |
| `W` | `window.new` (prompts) | New window, edit current URL | yes |
| `ww` | `window.new` (prompts) | New window, edit current URL | yes |
| `wo` | `window.new` (prompts) | New window, enter URL | yes |
| `wn` | `window.new` | New window | yes |
| `wp` | `window.new --private` | New private window | yes |
| `wc` | `window.close` | Close window | yes |
| `wa` | `tab.attach` (prompts) | Attach tab to window | yes |
| `wd` | `tab.duplicate` | Duplicate tab | yes |
| `wD` | `tab.detach` | Detach tab | yes |
| `wh` | `hint --window` | Click element in new window |  |
| `wu` | `window.undo_close` | Reopen closed window | yes |
| `U` | `window.undo_close` | Reopen closed window | yes |
| `yy` | `copy` | Copy URL |  |
| `yc` | `copy --canonical` | Copy URL |  |
| `ym` | `copy --markdown` | Copy URL |  |
| `yo` | `copy --org` | Copy URL |  |
| `ys` | `copy --short` | Copy URL |  |
| `yt` | `copy --title` | Copy URL |  |
| `yL` | `copylinks` | Copy page links |  |
| `yl` | `copylinks --viewport` | Copy links in view |  |
| `yT` | `copytabs` | Copy tab links | yes |
| `gu` | `url.parent` | Parent URL | yes |
| `gU` | `url.root` | Root URL | yes |
| `<C-a>` | `url.increment --up` | Change URL number | yes |
| `<C-x>` | `url.increment --down` | Change URL number | yes |
| `]c` | `url.increment --up` | Change URL number | yes |
| `[c` | `url.increment --down` | Change URL number | yes |
| `gi` | `page.focus_input` | Focus input |  |
| `I` | `hint --lists ; page.item --current` | Pick a list for item mode |  |
| `i` | `mode.insert` | Insert mode |  |
| `pp` | `paste` | Open clipboard | yes |
| `pt` | `paste --tab` | Open clipboard | yes |
| `pw` | `paste --window` | Open clipboard | yes |
| `P` | `paste --tab` | Open clipboard | yes |
| `pr` | `page.print` | Print | yes |
| `ps` | `page.save_pdf` | Save as PDF | yes |
| `ba` | `bookmark.add` (prompts) | Add bookmark, edit URL | yes |
| `bA` | `bookmark.add` (prompts) | Add bookmark, pick folder | yes |
| `be` | `bookmark.edit_url` (prompts) | Edit bookmark address | yes |
| `br` | `bookmark.rename` (prompts) | Rename bookmark | yes |
| `bm` | `bookmark.move` (prompts) | Move bookmark to folder | yes |
| `bf` | `bookmark.open_folder --tab` (prompts) | Open folder in tabs | yes |
| `bF` | `bookmark.open_folder --window` (prompts) | Open folder in a new window | yes |
| `bd` | `bookmark.remove` | Remove bookmark | yes |
| `bD` | `bookmark.remove` (prompts) | Remove bookmark, pick from list | yes |
| `bb` | `bookmark` (prompts) | Open bookmark | yes |
| `B` | `bookmark --tab` (prompts) | Open bookmark | yes |
| `zi` | `zoom.by 0.1` | Zoom in | yes |
| `z+` | `zoom.by 0.1` | Zoom in | yes |
| `zo` | `zoom.by -0.1` | Zoom out | yes |
| `z-` | `zoom.by -0.1` | Zoom out | yes |
| `zm` | `zoom.by 0.5` | Zoom in a lot | yes |
| `zM` | `zoom.by 0.5` | Zoom in a lot | yes |
| `zr` | `zoom.by -0.5` | Zoom out a lot | yes |
| `zR` | `zoom.by -0.5` | Zoom out a lot | yes |
| `z=` | `zoom 1` | Reset zoom | yes |
| `zI` | `zoom 3` | Zoom to 300% | yes |
| `zO` | `zoom 0.3` | Zoom to 30% | yes |
| `zt` | `scroll.align --top` | Align focus |  |
| `zz` | `scroll.align` | Align focus |  |
| `zb` | `scroll.align --bottom` | Align focus |  |
| `<S-Escape>` | `mode ignore` | Set mode |  |
| `<S-Insert>` | `mode ignore` | Set mode |  |
| `<AC-Escape>` | `mode ignore` | Set mode |  |
| ``<AC-`>`` | `mode ignore` | Set mode |  |
| `<Escape>` | `mode.escape` | Escape |  |
| `<C-[>` | `mode.escape` | Escape |  |
| `<C-v>` | `mode.pass_next` | Pass next key |  |
| `<F1>` | `help` | Help | yes |
| `,r` | `config.reload` | Reload config | yes |
| `,h` | `help` | Help | yes |
| `,s` | `help settings` | Settings page | yes |
| `,t` | `toggle` (prompts) | Toggle a setting | yes |
| `,i` | `mode ignore` | Set mode |  |
| `,,` | `anything` (prompts) | Find anything | yes |
| `,b` | `page.blur` | Blur |  |
| `,e` | `pane.focus sidebar` | Focus the sidebar | yes |
| `,?` | `help.whichkey` | Which key |  |
| `<A-?>` | `help.whichkey` | Show the keys |  |
| `,"` | `registers` (prompts) | List registers | yes |
| `,fs` | `firefox settings` | Firefox settings | yes |
| `,fa` | `firefox addons` | Firefox add-ons | yes |
| `,fd` | `firefox downloads` | Firefox downloads | yes |
| `,fc` | `firefox config` | Firefox about:config | yes |
| `,fp` | `firefox profiles` | Firefox profiles | yes |
| `,fS` | `firefox support` | Firefox support info | yes |
| `,fD` | `firefox debugging` | Firefox debugging | yes |
| `,fl` | `firefox logins` | Firefox passwords | yes |
| `,fP` | `firefox processes` | Firefox processes | yes |
| `,ff` | `firefox` (prompts) | Firefox page | yes |
| `m` | `mark.add` | Set mark |  |
| `q` | `macro.record` | Record macro |  |
| `@` | `macro.play` | Play macro | yes |
| `'` | `mark.jump` | Jump to mark |  |
| `` ` `` | `mark.jump` | Jump to mark |  |
| `o` | `open` (prompts) | Open URL | yes |
| `O` | `open --tab` (prompts) | Open URL | yes |
| `ge` | `open` (prompts) | Open URL | yes |
| `gE` | `open --tab` (prompts) | Open URL | yes |
| `M` | `quickmark.add` | Add quickmark | yes |
| `go` | `quickmark.open` | Open quickmark | yes |
| `gn` | `quickmark.open --tab` | Open quickmark | yes |
| `f` | `hint` | Click element |  |
| `F` | `hint --background` | Click element in background tab |  |
| `v` | `mode caret` | Start caret mode |  |
| `V` | `mode visual` | Start visual mode |  |
| `;v` | `hint --caret --prose` | Start caret mode at text |  |
| `;V` | `hint --visual --prose` | Start visual mode at text |  |
| `;u` | `cmdline.open --text='hint --custom '` | Hint a CSS selector |  |
| `;;` | `cmdline.open --text='hint '` | Open the command line with hint |  |
| `;b` | `hint --buttons` | Click button |  |
| `;a` | `hint --every` | Click every element |  |
| `;t` | `hint --prose` | Click text |  |
| `;s` | `hint --grab-swipe --swipeable` | Swipe a carousel or slider with the keys |  |
| `;i` | `hint --inputs` | Click input |  |
| `;l` | `hint --links` | Click link |  |
| `;I` | `hint --images` | Open image in new tab |  |
| `;yl` | `hint --copy --links` | Copy link URL |  |
| `;yi` | `hint --copy-image --images` | Copy picture |  |
| `;yI` | `hint --copy --images` | Copy image URL |  |
| `;ym` | `hint --copy --media` | Copy media URL |  |
| `;yf` | `hint --copy --frames` | Copy frame URL |  |
| `;yt` | `hint --copy-text --all` | Copy text |  |
| `;yc` | `hint --copy-selector --every` | Copy CSS selector |  |
| `;Y` | `hint --copy --links --rapid` | Copy several link URLs |  |
| `;yh` | `hint --copy-html --every` | Copy outer HTML |  |
| `;ff` | `hint --frames` | Focus frame |  |
| `;of` | `hint --inspect --frames` | Inspect frame |  |
| `;hf` | `hint --hover --frames` | Hover frame |  |
| `;xf` | `hint --delete --frames` | Delete frame |  |
| `;fF` | `frame.exit` | Focus top page |  |
| `;fs` | `hint --focus --scrollable` | Focus scroll box |  |
| `;fe` | `page.focus_input` | Main input |  |
| `;fh` | `hint --focus --headings` | Focus heading |  |
| `;m` | `hint --media` | Play or pause media |  |
| `;M` | `hint --enter-media --media` | Start media mode at a video |  |
| `;gg` | `hint --grab --draggable` | Grab an element and drop it on a target |  |
| `;Gg` | `hint --grab-move --draggable` | Grab an element and move it with the keys |  |
| `:` | `cmdline.open` | Command line |  |
| `/` | `find` | Find forward |  |
| `?` | `find --backward` | Find backward |  |
| `*` | `find --word` | Find word forward |  |
| `#` | `find --backward --word` | Find word backward |  |
| `n` | `find.next` | Next match |  |
| `N` | `find.prev` | Previous match |  |
| `g?` | `help` | Help | yes |
| `gV` | `mode caret` | Set mode |  |

Which-key group names:

- `g`: Go
- `go`: Open quickmark
- `gn`: Open quickmark in new tab
- `gx`: Close tabs
- `d`: Close
- `x`: Stop or close
- `r`: Reload
- `p`: Page
- `<`: Move Left
- `>`: Move Right
- `[`: Previous
- `]`: Next
- `t`: Tabs
- `tg`: Tab groups
- `tu`: Unload tabs
- `tU`: Load tabs
- `w`: Windows
- `E`: Pane
- `y`: Copy
- `b`: Bookmark
- `z`: Zoom and scroll
- `,`: DesertFox
- `,f`: Firefox pages
- `q`: Record macro
- `@`: Play macro
- `;`: Hints
- `;y`: Yank
- `s`: Search here
- `S`: Search in new tab
- `s/`: Site search
- `S/`: Site search in new tab
- `c`: Reopen in container
- `C`: Open in container
- `a`: Media

### media

| Key | Command | Label |
| --- | --- | --- |
| `0` | `media seek reset` | Seek to the start |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `?` | `help.whichkey` | Show the keys |
| `<A-?>` | `help.whichkey` | Show the keys |
| `F` | `media fullscreen` | Toggle fullscreen |
| `h` | `media seek down` | Seek back |
| `l` | `media seek up` | Seek forward |
| `$` | `media seek end` | Seek to the end |
| `%` | `media seek percent` | Seek to a percent, as 50% |
| `H` | `media skip previous` | Previous video |
| `L` | `media skip next` | Next video |
| `j` | `media volume down` | Volume down |
| `k` | `media volume up` | Volume up |
| `<` | `media speed down` | Slow down |
| `>` | `media speed up` | Speed up |
| `=` | `media speed reset` | Reset speed |
| `c` | `media captions` | Toggle captions |
| `,` | `media frame down` | Previous frame |
| `.` | `media frame up` | Next frame |
| `m` | `media mute` | Mute or unmute |
| `<Space>` | `media play_pause` | Play or pause |
| `p` | `media pip` | Toggle picture-in-picture |
| `q` | `cmdline.open --text='media quality '` | Pick the quality |
| `r` | `media loop` | Toggle loop |
| `i` | `media info` | Show the time, speed, quality and volume |

Every key of normal mode that this table does not bind also works here: it runs as in normal mode. A key of normal mode comes here only when each command of the key runs in media mode. This mode unbinds `aa`.

### item

| Key | Command | Label |
| --- | --- | --- |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `?` | `help.whichkey` | Show the keys |
| `<A-?>` | `help.whichkey` | Show the keys |
| `I` | `hint --lists ; page.item --current` | Pick a list for item mode |
| `zt` | `page.item --current ; scroll.align --top` | Back to the current item, at the top |
| `zz` | `page.item --current ; scroll.align` | Back to the current item, in the middle |
| `zb` | `page.item --current ; scroll.align --bottom` | Back to the current item, at the bottom |
| `za` | `tree --toggle --aria` | Fold or unfold the tree item |
| `zc` | `tree --fold --aria` | Fold the tree item, or the parent of a leaf |
| `zo` | `tree --unfold --aria` | Unfold the tree item |
| `<Space>` | `item_action --toggle` | Toggle the item's checkbox |
| `<Enter>` | `item_action --open` | Open the item's link, or click the focused element in it |
| `<C-Enter>` | `item_action --open-background` | Open the item's link in a background tab |
| `<Tab>` | `item_focus next` | Focus the next element in the item |
| `<S-Tab>` | `item_focus prev` | Focus the previous element in the item |
| `v` | `mode item_visual ; page.item --current --extend` | Select a range of items |
| `V` | `mode item_visual ; page.item --current --extend` | Select a range of items |
| `j` | `page.item --down --hover` | Next item, or scroll down |
| `k` | `page.item --up --hover` | Previous item, or scroll up |
| `h` | `tree --left --aria` | Fold, else parent in a tree, else the item to the left |
| `l` | `tree --child --aria` | First child in a tree or open it, else the item to the right |
| `}` | `tree --next --aria` | Next sibling in a tree, else the next section |
| `{` | `tree --prev --aria` | Previous sibling in a tree, else the previous section |
| `gg` | `page.item --first --hover` | First item, or scroll to top |
| `G` | `page.item --last --hover` | Last item, or scroll to bottom |

Every key of normal mode that this table does not bind also works here: it runs as in normal mode. A key of normal mode comes here only when each command of the key runs in item mode. This mode unbinds `;fF`, `;fe` and `gF`.

### item_visual

| Key | Command | Label |
| --- | --- | --- |
| `j` | `page.item --down --extend` | Extend to the next item |
| `k` | `page.item --up --extend` | Extend to the previous item |
| `h` | `page.item --left --extend` | Extend to the item on the left |
| `l` | `page.item --right --extend` | Extend to the item on the right |
| `}` | `page.item --next-section --extend` | Extend to the next section |
| `{` | `page.item --prev-section --extend` | Extend to the previous section |
| `gg` | `page.item --first --extend` | Extend to the first item |
| `G` | `page.item --last --extend` | Extend to the last item |
| `<Space>` | `item_action --toggle-range` | Toggle the checkboxes of the range |
| `<Enter>` | `item_action --open-range` | Open the first item here and the rest in background tabs, then end the selection |
| `<C-Enter>` | `item_action --open-background` | Open every selected item in background tabs, then end the selection |
| `o` | `page.item --other-end --extend` | Swap the ends of the selection |
| `v` | `mode item` | End the selection |
| `V` | `mode item` | End the selection |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `?` | `help.whichkey` | Show the keys |
| `<A-?>` | `help.whichkey` | Show the keys |

Every key of item mode that this table does not bind also works here: it switches to item mode first and then runs as there.

### grab

| Key | Command | Label |
| --- | --- | --- |
| `h` | `grab.move left` | Move left |
| `j` | `grab.move down` | Move down |
| `k` | `grab.move up` | Move up |
| `l` | `grab.move right` | Move right |
| `[` | `grab.step finer` | Halve the step |
| `]` | `grab.step coarser` | Double the step |
| `<Enter>` | `grab.drop` | Drop |
| `<Escape>` | `grab.cancel` | Cancel the grab |
| `<C-[>` | `grab.cancel` | Cancel the grab |
| `?` | `help.whichkey` | Show the keys |
| `<A-?>` | `help.whichkey` | Show the keys |

### sidebar

| Key | Command | Label |
| --- | --- | --- |
| `j` | `sidebar_down` | Next row |
| `k` | `sidebar_up` | Previous row |
| `gg` | `sidebar_first` | First row |
| `G` | `sidebar_last` | Last row |
| `<Enter>` | `sidebar_open` | Open the row |
| `l` | `sidebar_expand` | Expand the row |
| `h` | `sidebar_collapse` | Collapse the row |
| `d` | `sidebar_close_item` | Close the tab |
| `/` | `sidebar_filter` | Filter the list |
| `<Escape>` | `sidebar_leave` | Leave the sidebar |

### hint

| Key | Command | Label |
| --- | --- | --- |
| `<A-?>` | `help.whichkey` | Show the keys |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `/` | `hint.key slash` | Type link text |
| `<Tab>` | `hint.key tab` | Next match, or turn overlapping labels (every element in a grab drop) |
| `<S-Tab>` | `hint.key shift_tab` | Previous match, or turn overlapping labels back |
| `<Enter>` | `hint.key enter` | Pick the active match |
| `<Space>` | `hint.key space` | Rapid on or off (in label mode) |

### cmdline

| Key | Command | Label |
| --- | --- | --- |
| `<Escape>` | `mode.escape` | Escape |
| `<Tab>` | `cmdline.next_completion` | Next completion |
| `<C-n>` | `cmdline.next_completion` | Next completion |
| `<A-ArrowDown>` | `cmdline.next_completion` | Next completion |
| `<S-Tab>` | `cmdline.prev_completion` | Previous completion |
| `<C-p>` | `cmdline.prev_completion` | Previous completion |
| `<A-ArrowUp>` | `cmdline.prev_completion` | Previous completion |
| `<Enter>` | `cmdline.submit` | Submit |
| `<S-Enter>` | `cmdline.submit --tab` | Run and open in a new tab |
| `<ArrowUp>` | `cmdline.history prev` | History |
| `<ArrowDown>` | `cmdline.history next` | History |
| `<C-u>` | `cmdline.clear` | Clear line |
| `<C-h>` | `cmdline.help` | Command help |
| `<A-u>` | `list.act unload` | Unload or load the tab |
| `<C-Space>` | `list.select toggle` | Mark or unmark the tab |
| `<A-x>` | `list.act close` | Close the tab |
| `<A-m>` | `list.act mute` | Mute or unmute the tab |
| `<A-p>` | `list.act pin` | Pin or unpin the tab |
| `<A-c>` | `list.act reopen` | Reopen the tab in a container |

### caret

| Key | Command | Label |
| --- | --- | --- |
| `0` | `caret.move --line-start` | Move caret |
| `<A-?>` | `help.whichkey` | Show the keys |
| `v` | `mode visual` | Set mode |
| `V` | `mode visual_line` | Start line visual mode |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `/` | `find` | Find forward |
| `?` | `find --backward` | Find backward |
| `*` | `find --word` | Find word forward |
| `#` | `find --backward --word` | Find word backward |
| `n` | `find.next` | Next match |
| `N` | `find.prev` | Previous match |
| `h` | `caret.move --char --back` | Move caret |
| `l` | `caret.move --char` | Move caret |
| `j` | `caret.move --line` | Move caret |
| `k` | `caret.move --line --back` | Move caret |
| `<ArrowLeft>` | `caret.move --char --back` | Move caret |
| `<ArrowRight>` | `caret.move --char` | Move caret |
| `<ArrowDown>` | `caret.move --line` | Move caret |
| `<ArrowUp>` | `caret.move --line --back` | Move caret |
| `w` | `caret.move --word` | Move caret |
| `b` | `caret.move --word --back` | Move caret |
| `e` | `caret.move --word-end` | Move caret |
| `W` | `caret.move --word --big` | Move caret by WORD |
| `B` | `caret.move --word --back --big` | Move caret by WORD backward |
| `E` | `caret.move --word-end --big` | Move caret to WORD end |
| `^` | `caret.move --line-first` | Move caret |
| `$` | `caret.move --line-end` | Move caret |
| `gg` | `caret.move --start` | Move caret |
| `G` | `caret.move --end` | Move caret |
| `f` | `caret.find` | Move to a character |
| `t` | `caret.find --till` | Move before a character |
| `F` | `caret.find --back` | Move back to a character |
| `T` | `caret.find --back --till` | Move back after a character |
| `;` | `caret.move --find-repeat` | Repeat the character find |
| `,` | `caret.move --find-repeat --back` | Repeat the character find backward |

### visual

| Key | Command | Label |
| --- | --- | --- |
| `0` | `caret.move --line-start` | Move caret |
| `h` | `caret.move --char --back` | Move caret |
| `l` | `caret.move --char` | Move caret |
| `j` | `caret.move --line` | Move caret |
| `k` | `caret.move --line --back` | Move caret |
| `<ArrowLeft>` | `caret.move --char --back` | Move caret |
| `<ArrowRight>` | `caret.move --char` | Move caret |
| `<ArrowDown>` | `caret.move --line` | Move caret |
| `<ArrowUp>` | `caret.move --line --back` | Move caret |
| `w` | `caret.move --word` | Move caret |
| `b` | `caret.move --word --back` | Move caret |
| `e` | `caret.move --word-end` | Move caret |
| `W` | `caret.move --word --big` | Move caret by WORD |
| `B` | `caret.move --word --back --big` | Move caret by WORD backward |
| `E` | `caret.move --word-end --big` | Move caret to WORD end |
| `^` | `caret.move --line-first` | Move caret |
| `$` | `caret.move --line-end` | Move caret |
| `gg` | `caret.move --start` | Move caret |
| `G` | `caret.move --end` | Move caret |
| `f` | `caret.find` | Move to a character |
| `t` | `caret.find --till` | Move before a character |
| `F` | `caret.find --back` | Move back to a character |
| `T` | `caret.find --back --till` | Move back after a character |
| `;` | `caret.move --find-repeat` | Repeat the character find |
| `,` | `caret.move --find-repeat --back` | Repeat the character find backward |
| `<A-?>` | `help.whichkey` | Show the keys |
| `/` | `find` | Find forward |
| `?` | `find --backward` | Find backward |
| `*` | `find --word` | Find word forward |
| `#` | `find --backward --word` | Find word backward |
| `n` | `find.next` | Next match |
| `N` | `find.prev` | Previous match |
| `y` | `visual.act yank` | Act on selection |
| `o` | `visual.act swap` | Act on selection |
| `s` | `visual.act search` | Act on selection |
| `aw` | `visual.object --word` | Select a text object |
| `iw` | `visual.object --word --inner` | Select a text object |
| `as` | `visual.object --sentence` | Select a text object |
| `is` | `visual.object --sentence --inner` | Select a text object |
| `p` | `visual.open` | Open the selection |
| `P` | `visual.open --tab` | Open the selection |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `V` | `mode visual_line` | Switch to line visual mode |

### visual_line

| Key | Command | Label |
| --- | --- | --- |
| `0` | `caret.move --line-start` | Move caret |
| `h` | `caret.move --char --back` | Move caret |
| `l` | `caret.move --char` | Move caret |
| `j` | `caret.move --line` | Move caret |
| `k` | `caret.move --line --back` | Move caret |
| `<ArrowLeft>` | `caret.move --char --back` | Move caret |
| `<ArrowRight>` | `caret.move --char` | Move caret |
| `<ArrowDown>` | `caret.move --line` | Move caret |
| `<ArrowUp>` | `caret.move --line --back` | Move caret |
| `w` | `caret.move --word` | Move caret |
| `b` | `caret.move --word --back` | Move caret |
| `e` | `caret.move --word-end` | Move caret |
| `W` | `caret.move --word --big` | Move caret by WORD |
| `B` | `caret.move --word --back --big` | Move caret by WORD backward |
| `E` | `caret.move --word-end --big` | Move caret to WORD end |
| `^` | `caret.move --line-first` | Move caret |
| `$` | `caret.move --line-end` | Move caret |
| `gg` | `caret.move --start` | Move caret |
| `G` | `caret.move --end` | Move caret |
| `f` | `caret.find` | Move to a character |
| `t` | `caret.find --till` | Move before a character |
| `F` | `caret.find --back` | Move back to a character |
| `T` | `caret.find --back --till` | Move back after a character |
| `;` | `caret.move --find-repeat` | Repeat the character find |
| `,` | `caret.move --find-repeat --back` | Repeat the character find backward |
| `<A-?>` | `help.whichkey` | Show the keys |
| `/` | `find` | Find forward |
| `?` | `find --backward` | Find backward |
| `*` | `find --word` | Find word forward |
| `#` | `find --backward --word` | Find word backward |
| `n` | `find.next` | Next match |
| `N` | `find.prev` | Previous match |
| `y` | `visual.act yank` | Act on selection |
| `o` | `visual.act swap` | Act on selection |
| `s` | `visual.act search` | Act on selection |
| `aw` | `visual.object --word` | Select a text object |
| `iw` | `visual.object --word --inner` | Select a text object |
| `as` | `visual.object --sentence` | Select a text object |
| `is` | `visual.object --sentence --inner` | Select a text object |
| `p` | `visual.open` | Open the selection |
| `P` | `visual.open --tab` | Open the selection |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `v` | `mode visual` | Switch to character visual mode |
| `V` | `mode caret` | Return to caret mode |

### insert

| Key | Command | Label |
| --- | --- | --- |
| `<A-?>` | `help.whichkey` | Show the keys |
| `<Escape>` | `mode.escape` | Escape |
| `<C-r>` | `register.paste` | Paste register |
| `<C-o>` | `text.edit_external` | Edit the field in the external editor |
| `<A-Escape>` | `page.send_key --key=Escape --key_code=27` | Send Escape to the page |

### ignore

| Key | Command | Label |
| --- | --- | --- |
| `<S-Escape>` | `mode normal` | Set mode |

### browser

| Key | Command | Label |
| --- | --- | --- |
| `<A-j>` | `tab.next` | Next tab |
| `<A-k>` | `tab.prev` | Previous tab |
| `<A-,>` | `browser.focus_page` | Focus page |
| `<A-l>` | `mode.site --toggle arrow` | Arrow mode |

<!-- END generated -->
