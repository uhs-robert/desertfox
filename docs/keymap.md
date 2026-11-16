# Binding map

The default keymap, generated from `src/background/default_keymap.ts`. Do not edit between the markers. Run `just docs-gen` after a change to it. `npm test` fails when the tables are stale.

Search engine keys (`s`, `S`, `,`) and container keys (`c`, `C`) come from the user's config, so no row lists them. The config generates them from `search_keys` and `container_keys`. One default is left unbound on purpose. `ZZ` closes every window with no undo, so users bind it in their config.

Which-key shows a group as `+Name`, for example `g` as `+Go`. A `group_names` section in `keymap.toml` maps a key sequence to its name. A group without one shows its prefix key.

A key shows the command label plus a phrase for each arg its binding sets, for example `gO` as "Open URL in new tab". Keys that set numbers carry a `label` in the default keymap, such as `h` as "Scroll left". The Label column shows that `label` or the command label. The rule is in [design.md](design.md#which-key).

The hint keys `;r ;B ;n ;d ;o ;h ;x ;2 ;g ;G` are modifiers, so no row lists their variants. A `[modifiers]` section in `keymap.toml` holds them. Each adds its args to a variant of every key in the `;` group: `;Bl` opens a link in a background tab, `;oa` selects any visible element in the DevTools Inspector, `;ha` hovers any element, `;2a` double-clicks any element but a link, `;xa` deletes any element, `;rl` opens links in background tabs and keeps picking. A variant exists only when the `hint` param schema accepts the combination. Keys that set their own `action` (`;s`, `;v`, `;V` and the `;y` yank keys) get none, and modifiers do not stack.

A register prefix `"<reg>` and a count go before any command in normal, caret, visual and visual line mode, so `"ay` yanks into register `a` and `"app` opens it. The prefix is no row below, because it is no key of the tree. In insert mode `<C-r><reg>` pastes a register.

The `caret`, `visual` and `cmdline` rows bind placeholder commands that refuse until their piece builds them.

A note "(prompts)" means the binding sets a `prompt` for a param, so the command line asks for it.

<!-- BEGIN generated -->

bound: 478 (normal 252, media 54, grab 11, hint 8, cmdline 19, caret 36, visual 44, visual_line 45, insert 5, ignore 1, browser 3)

### normal

| Key | Command | Label |
| --- | --- | --- |
| `h` | `scroll.pixels --dx=-50` | Scroll left |
| `l` | `scroll.pixels --dx=50` | Scroll right |
| `j` | `scroll 10` | Scroll down |
| `k` | `scroll -10` | Scroll up |
| `gg` | `scroll.to 0` | Scroll to top |
| `G` | `scroll.to 100` | Scroll to bottom |
| `$` | `scroll.to --x 100` | Scroll to right edge |
| `^` | `scroll.to --x 0` | Scroll to left edge |
| `<C-d>` | `scroll.pages --fraction=0.5` | Scroll half page down |
| `<C-u>` | `scroll.pages --fraction=-0.5` | Scroll half page up |
| `<C-f>` | `scroll.pages` | Scroll page down |
| `<C-b>` | `scroll.pages --fraction=-1` | Scroll page up |
| `H` | `page.back` | Back |
| `L` | `page.forward` | Forward |
| `<C-o>` | `page.jump --older` | Jump back |
| `<C-i>` | `page.jump --newer` | Jump forward |
| `rr` | `page.reload` | Reload |
| `rh` | `page.reload --hard` | Hard reload |
| `R` | `page.reload --hard` | Hard reload |
| `rc` | `page.reload --site` | Clear site data, reload |
| `rC` | `page.reload --all` (prompts) | Clear all data, reload |
| `xp` | `page.stop` | Stop loading |
| `gh` | `page.home` | Home page |
| `gH` | `page.home --tab` | Home page |
| `]]` | `page.follow --next` | Next page |
| `[[` | `page.follow --prev` | Previous page |
| `]i` | `page.focus_field --next` | Next form control |
| `[i` | `page.focus_field --prev` | Previous form control |
| `]h` | `page.heading --next` | Next heading |
| `[h` | `page.heading --prev` | Previous heading |
| `]l` | `page.focus_link --next` | Next link |
| `[l` | `page.focus_link --prev` | Previous link |
| `]g` | `tabgroup.next` | Next tab group |
| `[g` | `tabgroup.prev` | Previous tab group |
| `]t` | `tab.next` | Next tab |
| `[t` | `tab.prev` | Previous tab |
| `]T` | `tab.goto -1` | Last tab |
| `[T` | `tab.goto 1` | First tab |
| `]j` | `page.jump --newer` | Jump forward |
| `[j` | `page.jump --older` | Jump back |
| `]v` | `media skip next` | Next video |
| `[v` | `media skip previous` | Previous video |
| `sh` | `cmdline.open --text='heading '` | Search headings |
| `.` | `repeat` | Repeat |
| `J` | `tab.next` | Next tab |
| `K` | `tab.prev` | Previous tab |
| `gt` | `tab.goto` | Next tab |
| `gT` | `tab.prev` | Previous tab |
| `ga` | `tab.goto_audible` | Go to audible tab |
| `gl` | `tab.alternate` | Last used tab |
| `gL` | `tab.alternate_any_window` | Last used tab, any window |
| `gp` | `tab.split_other` | Other pane |
| `gP` | `tab.split_swap` | Swap panes |
| `gF` | `frame.exit` | Focus top page |
| `g0` | `tab.goto 1` | First tab |
| `g$` | `tab.goto -1` | Last tab |
| `T` | `tab` (prompts) | Switch tab |
| `<<` | `tab.move --offset=-1` | Move tab left |
| `>>` | `tab.move --offset=1` | Move tab right |
| `xx` | `tab.close` | Close tab |
| `dd` | `tab.close` | Close tab |
| `D` | `tab.close --focus-previous` | Close tab |
| `dL` | `tab.close --all-after` | Close tabs after this one |
| `dH` | `tab.close --all-before` | Close tabs before this one |
| `gx0` | `tab.close --all-before` | Close tabs before this one |
| `gx$` | `tab.close --all-after` | Close tabs after this one |
| `u` | `tab.undo_close` | Reopen closed tab |
| `<A-p>` | `tab.pin` | Toggle pin |
| `<A-m>` | `tab.mute` | Toggle mute |
| `am` | `tab.mute` | Toggle mute |
| `aa` | `media enter` | Start media mode |
| `ap` | `media play_pause` | Play or pause |
| `as` | `media speed up` | Speed up |
| `aS` | `media speed down` | Slow down |
| `ar` | `media speed reset` | Reset speed |
| `av` | `media volume up` | Volume up |
| `aV` | `media volume down` | Volume down |
| `al` | `media seek up` | Seek forward |
| `ah` | `media seek down` | Seek back |
| `aP` | `media pip` | Toggle picture-in-picture |
| `af` | `media fullscreen` | Toggle fullscreen |
| `A` | `cmdline.open --text='media '` | Media command |
| `tt` | `open --tab` (prompts) | Open URL |
| `tT` | `tab` (prompts) | Switch tab |
| `ts` | `session.save` (prompts) | Save tab session |
| `tS` | `session.open` (prompts) | Open tab session |
| `td` | `tab.duplicate` | Duplicate tab |
| `tm` | `tab.move` (prompts) | Move tab |
| `tM` | `cmdline.open --text='tab.move --offset='` | Move tab by an offset |
| `tn` | `tab.next` | Next tab |
| `tp` | `tab.prev` | Previous tab |
| `ta` | `tab.goto_audible` | Go to audible tab |
| `t0` | `tab.goto 1` | First tab |
| `t$` | `tab.goto -1` | Last tab |
| `tl` | `tab.alternate` | Last used tab |
| `tL` | `tab.alternate_any_window` | Last used tab, any window |
| `tuu` | `tab.unload` | Unload tab |
| `tuh` | `tab.unload --all-before` | Unload tabs before this one |
| `tul` | `tab.unload --all-after` | Unload tabs after this one |
| `tUh` | `tab.load --all-before` | Load tabs before this one |
| `tUl` | `tab.load --all-after` | Load tabs after this one |
| `tga` | `tabgroup.add` (prompts) | Add tab to a group |
| `tgA` | `tabgroup.add` | Add tab to a new group |
| `tgd` | `tabgroup.remove` | Remove tab from group |
| `tgD` | `tabgroup.close` | Close tab group |
| `tgn` | `tabgroup.name` (prompts) | Name tab group |
| `tgc` | `tabgroup.collapse` | Collapse tab group |
| `tge` | `tabgroup.expand` | Expand tab group |
| `tgt` | `tabgroup.toggle` | Toggle tab group |
| `tgl` | `tabgroup.color` (prompts) | Color tab group |
| `tgj` | `tabgroup.next` | Next tab group |
| `tgk` | `tabgroup.prev` | Previous tab group |
| `W` | `window.new` (prompts) | New window, edit current URL |
| `ww` | `window.new` (prompts) | New window, edit current URL |
| `wo` | `window.new` (prompts) | New window, enter URL |
| `wn` | `window.new` | New window |
| `wp` | `window.new --private` | New private window |
| `wc` | `window.close` | Close window |
| `wa` | `tab.attach` (prompts) | Attach tab to window |
| `wd` | `tab.duplicate` | Duplicate tab |
| `wD` | `tab.detach` | Detach tab |
| `wh` | `hint --window` | Click element in new window |
| `wu` | `window.undo_close` | Reopen closed window |
| `U` | `window.undo_close` | Reopen closed window |
| `yy` | `copy` | Copy URL |
| `yc` | `copy --canonical` | Copy URL |
| `ym` | `copy --markdown` | Copy URL |
| `yo` | `copy --org` | Copy URL |
| `ys` | `copy --short` | Copy URL |
| `yt` | `copy --title` | Copy URL |
| `yL` | `copylinks` | Copy page links |
| `yl` | `copylinks --viewport` | Copy links in view |
| `yT` | `copytabs` | Copy tab links |
| `gu` | `url.parent` | Parent URL |
| `gU` | `url.root` | Root URL |
| `<C-a>` | `url.increment --up` | Change URL number |
| `<C-x>` | `url.increment --down` | Change URL number |
| `]c` | `url.increment --up` | Change URL number |
| `[c` | `url.increment --down` | Change URL number |
| `gi` | `page.focus_input` | Focus input |
| `I` | `page.focus_input` | Focus input |
| `i` | `mode.insert` | Insert mode |
| `pp` | `paste` | Open clipboard |
| `pt` | `paste --tab` | Open clipboard |
| `pw` | `paste --window` | Open clipboard |
| `P` | `paste --tab` | Open clipboard |
| `pr` | `page.print` | Print |
| `ps` | `page.save_pdf` | Save as PDF |
| `ba` | `bookmark.add` (prompts) | Add bookmark, edit URL |
| `bA` | `bookmark.add` (prompts) | Add bookmark, pick folder |
| `be` | `bookmark.edit_url` (prompts) | Edit bookmark address |
| `br` | `bookmark.rename` (prompts) | Rename bookmark |
| `bm` | `bookmark.move` (prompts) | Move bookmark to folder |
| `bf` | `bookmark.open_folder --tab` (prompts) | Open folder in tabs |
| `bF` | `bookmark.open_folder --window` (prompts) | Open folder in a new window |
| `bd` | `bookmark.remove` | Remove bookmark |
| `bD` | `bookmark.remove` (prompts) | Remove bookmark, pick from list |
| `bb` | `bookmark` (prompts) | Open bookmark |
| `B` | `bookmark --tab` (prompts) | Open bookmark |
| `zi` | `zoom.by 0.1` | Zoom in |
| `z+` | `zoom.by 0.1` | Zoom in |
| `zo` | `zoom.by -0.1` | Zoom out |
| `z-` | `zoom.by -0.1` | Zoom out |
| `zm` | `zoom.by 0.5` | Zoom in a lot |
| `zM` | `zoom.by 0.5` | Zoom in a lot |
| `zr` | `zoom.by -0.5` | Zoom out a lot |
| `zR` | `zoom.by -0.5` | Zoom out a lot |
| `z=` | `zoom 1` | Reset zoom |
| `zI` | `zoom 3` | Zoom to 300% |
| `zO` | `zoom 0.3` | Zoom to 30% |
| `zt` | `scroll.align --top` | Align focus |
| `zz` | `scroll.align` | Align focus |
| `zb` | `scroll.align --bottom` | Align focus |
| `<S-Escape>` | `mode ignore` | Set mode |
| `<S-Insert>` | `mode ignore` | Set mode |
| `<AC-Escape>` | `mode ignore` | Set mode |
| ``<AC-`>`` | `mode ignore` | Set mode |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `<C-v>` | `mode.pass_next` | Pass next key |
| `<F1>` | `help` | Help |
| `,r` | `config.reload` | Reload config |
| `,h` | `help` | Help |
| `,s` | `help settings` | Settings page |
| `,t` | `toggle` (prompts) | Toggle a setting |
| `,i` | `mode ignore` | Set mode |
| `,,` | `anything` (prompts) | Find anything |
| `,b` | `page.blur` | Blur |
| `,?` | `help.whichkey` | Which key |
| `<A-?>` | `help.whichkey` | Show the keys |
| `,"` | `registers` (prompts) | List registers |
| `,fs` | `firefox settings` | Firefox settings |
| `,fa` | `firefox addons` | Firefox add-ons |
| `,fd` | `firefox downloads` | Firefox downloads |
| `,fc` | `firefox config` | Firefox about:config |
| `,fp` | `firefox profiles` | Firefox profiles |
| `,fS` | `firefox support` | Firefox support info |
| `,fD` | `firefox debugging` | Firefox debugging |
| `,fl` | `firefox logins` | Firefox passwords |
| `,fP` | `firefox processes` | Firefox processes |
| `,ff` | `firefox` (prompts) | Firefox page |
| `m` | `mark.add` | Set mark |
| `q` | `macro.record` | Record macro |
| `@` | `macro.play` | Play macro |
| `'` | `mark.jump` | Jump to mark |
| `` ` `` | `mark.jump` | Jump to mark |
| `o` | `open` (prompts) | Open URL |
| `O` | `open --tab` (prompts) | Open URL |
| `ge` | `open` (prompts) | Open URL |
| `gE` | `open --tab` (prompts) | Open URL |
| `M` | `quickmark.add` | Add quickmark |
| `go` | `quickmark.open` | Open quickmark |
| `gn` | `quickmark.open --tab` | Open quickmark |
| `f` | `hint` | Click element |
| `F` | `hint --background` | Click element in background tab |
| `v` | `mode caret` | Start caret mode |
| `V` | `mode visual` | Start visual mode |
| `;v` | `hint --caret --prose` | Start caret mode at text |
| `;V` | `hint --visual --prose` | Start visual mode at text |
| `;u` | `cmdline.open --text='hint --custom '` | Hint a CSS selector |
| `;;` | `cmdline.open --text='hint '` | Open the command line with hint |
| `;b` | `hint --buttons` | Click button |
| `;a` | `hint --every` | Click every element |
| `;t` | `hint --prose` | Click text |
| `;s` | `hint --focus --scrollable` | Focus scroll box |
| `;i` | `hint --inputs` | Click input |
| `;l` | `hint --links` | Click link |
| `;I` | `hint --images` | Open image in new tab |
| `;yl` | `hint --copy --links` | Copy link URL |
| `;yi` | `hint --copy-image --images` | Copy picture |
| `;yI` | `hint --copy --images` | Copy image URL |
| `;ym` | `hint --copy --media` | Copy media URL |
| `;yf` | `hint --copy --frames` | Copy frame URL |
| `;yt` | `hint --copy-text --all` | Copy text |
| `;yc` | `hint --copy-selector --every` | Copy CSS selector |
| `;Y` | `hint --copy --links --rapid` | Copy several link URLs |
| `;yh` | `hint --copy-html --every` | Copy outer HTML |
| `;f` | `hint --frames` | Focus frame |
| `;m` | `hint --media` | Play or pause media |
| `;M` | `hint --enter-media --media` | Start media mode at a video |
| `;gg` | `hint --grab --draggable` | Grab an element and drop it on a target |
| `;Gg` | `hint --grab-move --draggable` | Grab an element and move it with the keys |
| `;w` | `hint --grab-swipe --swipeable` | Swipe a carousel or slider with the keys |
| `:` | `cmdline.open` | Command line |
| `/` | `find` | Find forward |
| `?` | `find --backward` | Find backward |
| `*` | `find --word` | Find word forward |
| `#` | `find --backward --word` | Find word backward |
| `n` | `find.next` | Next match |
| `N` | `find.prev` | Previous match |
| `g?` | `help` | Help |
| `gV` | `mode caret` | Set mode |

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
| `f` | `hint` | Click element |
| `;v` | `hint --caret --prose` | Start caret mode at text |
| `;V` | `hint --visual --prose` | Start visual mode at text |
| `;u` | `cmdline.open --text='hint --custom '` | Hint a CSS selector |
| `;;` | `cmdline.open --text='hint '` | Open the command line with hint |
| `;b` | `hint --buttons` | Click button |
| `;a` | `hint --every` | Click every element |
| `;t` | `hint --prose` | Click text |
| `;s` | `hint --focus --scrollable` | Focus scroll box |
| `;i` | `hint --inputs` | Click input |
| `;l` | `hint --links` | Click link |
| `;I` | `hint --images` | Open image in new tab |
| `;yl` | `hint --copy --links` | Copy link URL |
| `;yi` | `hint --copy-image --images` | Copy picture |
| `;yI` | `hint --copy --images` | Copy image URL |
| `;ym` | `hint --copy --media` | Copy media URL |
| `;yf` | `hint --copy --frames` | Copy frame URL |
| `;yt` | `hint --copy-text --all` | Copy text |
| `;yc` | `hint --copy-selector --every` | Copy CSS selector |
| `;Y` | `hint --copy --links --rapid` | Copy several link URLs |
| `;yh` | `hint --copy-html --every` | Copy outer HTML |
| `;f` | `hint --frames` | Focus frame |
| `;m` | `hint --media` | Play or pause media |
| `;M` | `hint --enter-media --media` | Start media mode at a video |
| `;gg` | `hint --grab --draggable` | Grab an element and drop it on a target |
| `;Gg` | `hint --grab-move --draggable` | Grab an element and move it with the keys |
| `;w` | `hint --grab-swipe --swipeable` | Swipe a carousel or slider with the keys |
| `:` | `cmdline.open` | Command line |
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

### hint

| Key | Command | Label |
| --- | --- | --- |
| `<A-?>` | `help.whichkey` | Show the keys |
| `<Escape>` | `mode.escape` | Escape |
| `<C-[>` | `mode.escape` | Escape |
| `/` | `hint.key slash` | Type link text |
| `<Tab>` | `hint.key tab` | Next match, or label every element |
| `<S-Tab>` | `hint.key shift_tab` | Previous match |
| `<Enter>` | `hint.key enter` | Pick the active match |
| `<Space>` | `hint.key space` | Turn overlapping labels |

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

<!-- END generated -->
