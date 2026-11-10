# Binding map

The default keymap, generated from `src/background/default_keymap.ts` and `docs/keymap_planned.toml`. Do not edit between the markers. Run `just docs-gen` after a change to either source. `npm test` fails when the tables are stale.

Status values:

- `bound`: the default keymap binds the key.
- `later`: planned for phase 3. The key is not bound yet.
- `dropped`: not built. The note gives the reason.

Search engine keys (`s`, `S`, `,`) and container keys (`c`, `C`) come from the user's config, so no row lists them. The config generates them from `search_keys` and `container_keys`. One default is left unbound on purpose. `ZZ` closes every window with no undo, so users bind it in their config.

Which-key shows a group as `+Name`, for example `g` as `+Go`. A `group_names` section in `keymap.toml` maps a key sequence to its name. A group without one shows its prefix key.

A key shows the command label plus a phrase for each arg its binding sets, for example `gO` as "Open URL in new tab". Keys that set numbers carry a `label` in the default keymap, such as `h` as "Scroll left". The Label column shows that `label` or the command label. The rule is in [design.md](design.md#which-key).

The hint keys `;r ;B ;W ;d ;o ;h ;x ;2` are modifiers, so no row lists their variants. A `[modifiers]` section in `keymap.toml` holds them. Each adds its args to a variant of every key in the `;` group: `;Bl` opens a link in a background tab, `;oa` selects any visible element in the DevTools Inspector, `;ha` hovers any element, `;2a` double-clicks any element but a link, `;xa` deletes any element, `;rl` opens links in background tabs and keeps picking. A variant exists only when the `hint` param schema accepts the combination. Keys that set their own `action` (`;s`, `;v`, `;V` and the `;y` yank keys) get none, and modifiers do not stack.

A register prefix `"<reg>` and a count go before any command in normal, caret, visual and visual line mode, so `"ay` yanks into register `a` and `"ap` opens it. The prefix is no row below, because it is no key of the tree. In insert mode `<C-r><reg>` pastes a register.

The `caret`, `visual` and `cmdline` rows bind placeholder commands that refuse until their piece builds them.

A note "(prompts)" means the binding sets a `prompt` for a param, so the command line asks for it.

<!-- BEGIN generated -->

bound: 312 (normal 176, hint 2, cmdline 18, caret 35, visual 37, visual_line 38, insert 2, ignore 1, browser 3) | later: 4 | dropped: 7

### normal

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `h` | bound | `scroll.pixels --dx=-50` | Scroll left |  |
| `l` | bound | `scroll.pixels --dx=50` | Scroll right |  |
| `j` | bound | `scroll 10` | Scroll down |  |
| `k` | bound | `scroll -10` | Scroll up |  |
| `gg` | bound | `scroll.to 0` | Scroll to top |  |
| `G` | bound | `scroll.to 100` | Scroll to bottom |  |
| `$` | bound | `scroll.to --x 100` | Scroll to right edge |  |
| `^` | bound | `scroll.to --x 0` | Scroll to left edge |  |
| `<C-d>` | bound | `scroll.pages --fraction=0.5` | Scroll half page down |  |
| `<C-u>` | bound | `scroll.pages --fraction=-0.5` | Scroll half page up |  |
| `<C-f>` | bound | `scroll.pages` | Scroll page down |  |
| `<C-b>` | bound | `scroll.pages --fraction=-1` | Scroll page up |  |
| `H` | bound | `page.back` | Back |  |
| `L` | bound | `page.forward` | Forward |  |
| `rr` | bound | `page.reload` | Reload |  |
| `rh` | bound | `page.reload --hard` | Hard reload |  |
| `R` | bound | `page.reload --hard` | Hard reload |  |
| `xp` | bound | `page.stop` | Stop loading |  |
| `gh` | bound | `page.home` | Home page |  |
| `gH` | bound | `page.home --tab` | Home page |  |
| `]]` | bound | `page.follow --next` | Next page |  |
| `[[` | bound | `page.follow --prev` | Previous page |  |
| `]i` | bound | `page.focus_field --next` | Next form control |  |
| `[i` | bound | `page.focus_field --prev` | Previous form control |  |
| `]h` | bound | `page.heading --next` | Next heading |  |
| `[h` | bound | `page.heading --prev` | Previous heading |  |
| `sh` | bound | `cmdline.open --text='heading '` | Search headings |  |
| `.` | bound | `repeat` | Repeat |  |
| `J` | bound | `tab.next` | Next tab |  |
| `K` | bound | `tab.prev` | Previous tab |  |
| `gt` | bound | `tab.goto` | Next tab |  |
| `gT` | bound | `tab.prev` | Previous tab |  |
| `ga` | bound | `tab.goto_audible` | Go to audible tab |  |
| `gF` | bound | `frame.exit` | Focus top page |  |
| `g0` | bound | `tab.goto 1` | First tab |  |
| `g^` | bound | `tab.goto 1` | First tab |  |
| `g$` | bound | `tab.goto -1` | Last tab |  |
| `T` | bound | `tab` (prompts) | Switch tab |  |
| `<<` | bound | `tab.move --offset=-1` | Move tab left |  |
| `>>` | bound | `tab.move --offset=1` | Move tab right |  |
| `xx` | bound | `tab.close` | Close tab |  |
| `dd` | bound | `tab.close` | Close tab |  |
| `D` | bound | `tab.close --focus-previous` | Close tab |  |
| `dL` | bound | `tab.close --all-after` | Close tabs after this one |  |
| `dH` | bound | `tab.close --all-before` | Close tabs before this one |  |
| `gx0` | bound | `tab.close --all-before` | Close tabs before this one |  |
| `gx$` | bound | `tab.close --all-after` | Close tabs after this one |  |
| `u` | bound | `tab.undo_close` | Reopen closed tab |  |
| `<A-p>` | bound | `tab.pin` | Toggle pin |  |
| `<A-m>` | bound | `tab.mute` | Toggle mute |  |
| `tt` | bound | `open --tab` (prompts) | Open URL |  |
| `tT` | bound | `tab` (prompts) | Switch tab |  |
| `ts` | bound | `session.save` (prompts) | Save tab session |  |
| `tS` | bound | `session.open` (prompts) | Open tab session |  |
| `td` | bound | `tab.duplicate` | Duplicate tab |  |
| `tm` | bound | `tab.move` (prompts) | Move tab |  |
| `tn` | bound | `tab.next` | Next tab |  |
| `tp` | bound | `tab.prev` | Previous tab |  |
| `ta` | bound | `tab.goto_audible` | Go to audible tab |  |
| `tf` | bound | `tab.goto 1` | First tab |  |
| `tl` | bound | `tab.goto -1` | Last tab |  |
| `tu` | bound | `tab.unload` | Unload tab |  |
| `tU` | bound | `tab.load` | Load tab |  |
| `tH` | bound | `tab.unload --all-before` | Unload tabs before this one |  |
| `tL` | bound | `tab.unload --all-after` | Unload tabs after this one |  |
| `W` | bound | `window.new` (prompts) | New window, edit current URL |  |
| `ww` | bound | `window.new` (prompts) | New window, edit current URL |  |
| `wo` | bound | `window.new` (prompts) | New window, enter URL |  |
| `wn` | bound | `window.new` | New window |  |
| `wp` | bound | `window.new --private` | New private window |  |
| `wc` | bound | `window.close` | Close window |  |
| `wa` | bound | `tab.attach` (prompts) | Attach tab to window |  |
| `wd` | bound | `tab.duplicate` | Duplicate tab |  |
| `wD` | bound | `tab.detach` | Detach tab |  |
| `wh` | bound | `hint --window` | Click element in new window |  |
| `wu` | bound | `window.undo_close` | Reopen closed window |  |
| `U` | bound | `window.undo_close` | Reopen closed window |  |
| `yy` | bound | `copy` | Copy URL |  |
| `yc` | bound | `copy --canonical` | Copy URL |  |
| `ym` | bound | `copy --markdown` | Copy URL |  |
| `yo` | bound | `copy --org` | Copy URL |  |
| `ys` | bound | `copy --short` | Copy URL |  |
| `yt` | bound | `copy --title` | Copy URL |  |
| `yL` | bound | `copylinks` | Copy page links |  |
| `yl` | bound | `copylinks --viewport` | Copy links in view |  |
| `gu` | bound | `url.parent` | Parent URL |  |
| `gU` | bound | `url.root` | Root URL |  |
| `<C-a>` | bound | `url.increment --up` | Change URL number |  |
| `<C-x>` | bound | `url.increment --down` | Change URL number |  |
| `]c` | bound | `url.increment --up` | Change URL number |  |
| `[c` | bound | `url.increment --down` | Change URL number |  |
| `gi` | bound | `page.focus_input` | Focus input |  |
| `p` | bound | `paste` | Open clipboard |  |
| `P` | bound | `paste --tab` | Open clipboard |  |
| `ba` | bound | `bookmark.add` (prompts) | Add bookmark, edit URL |  |
| `bA` | bound | `bookmark.add` (prompts) | Add bookmark, pick folder |  |
| `be` | bound | `bookmark.edit_url` (prompts) | Edit bookmark address |  |
| `br` | bound | `bookmark.rename` (prompts) | Rename bookmark |  |
| `bm` | bound | `bookmark.move` (prompts) | Move bookmark to folder |  |
| `bf` | bound | `bookmark.open_folder --tab` (prompts) | Open folder in tabs |  |
| `bF` | bound | `bookmark.open_folder --window` (prompts) | Open folder in a new window |  |
| `bd` | bound | `bookmark.remove` | Remove bookmark |  |
| `bD` | bound | `bookmark.remove` (prompts) | Remove bookmark, pick from list |  |
| `bb` | bound | `bookmark` (prompts) | Open bookmark |  |
| `B` | bound | `bookmark --tab` (prompts) | Open bookmark |  |
| `zi` | bound | `zoom.by 0.1` | Zoom in |  |
| `z+` | bound | `zoom.by 0.1` | Zoom in |  |
| `zo` | bound | `zoom.by -0.1` | Zoom out |  |
| `z-` | bound | `zoom.by -0.1` | Zoom out |  |
| `zm` | bound | `zoom.by 0.5` | Zoom in a lot |  |
| `zM` | bound | `zoom.by 0.5` | Zoom in a lot |  |
| `zr` | bound | `zoom.by -0.5` | Zoom out a lot |  |
| `zR` | bound | `zoom.by -0.5` | Zoom out a lot |  |
| `z=` | bound | `zoom 1` | Reset zoom |  |
| `zI` | bound | `zoom 3` | Zoom to 300% |  |
| `zO` | bound | `zoom 0.3` | Zoom to 30% |  |
| `zt` | bound | `scroll.align --top` | Align focus |  |
| `zz` | bound | `scroll.align` | Align focus |  |
| `zb` | bound | `scroll.align --bottom` | Align focus |  |
| `<S-Escape>` | bound | `mode ignore` | Set mode |  |
| `<S-Insert>` | bound | `mode ignore` | Set mode |  |
| `<AC-Escape>` | bound | `mode ignore` | Set mode |  |
| ``<AC-`>`` | bound | `mode ignore` | Set mode |  |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-[>` | bound | `mode.escape` | Escape |  |
| `<C-v>` | bound | `mode.pass_next` | Pass next key |  |
| `<F1>` | bound | `help` | Help |  |
| `,r` | bound | `config.reload` | Reload config |  |
| `,h` | bound | `help` | Help |  |
| `,s` | bound | `help settings` | Settings page |  |
| `,t` | bound | `toggle` (prompts) | Toggle a setting |  |
| `,i` | bound | `mode ignore` | Set mode |  |
| `,b` | bound | `page.blur` | Blur |  |
| `,?` | bound | `help.whichkey` | Which key |  |
| `,"` | bound | `registers` (prompts) | List registers |  |
| `m` | bound | `mark.add` | Set mark |  |
| `'` | bound | `mark.jump` | Jump to mark |  |
| `` ` `` | bound | `mark.jump` | Jump to mark |  |
| `o` | bound | `open` (prompts) | Open URL |  |
| `O` | bound | `open --tab` (prompts) | Open URL |  |
| `go` | bound | `open` (prompts) | Open URL |  |
| `gO` | bound | `open --tab` (prompts) | Open URL |  |
| `f` | bound | `hint` | Click element |  |
| `F` | bound | `hint --background` | Click element in background tab |  |
| `v` | bound | `mode caret` | Start caret mode |  |
| `V` | bound | `mode visual` | Start visual mode |  |
| `;v` | bound | `hint --caret --prose` | Start caret mode at text |  |
| `;V` | bound | `hint --visual --prose` | Start visual mode at text |  |
| `;u` | bound | `cmdline.open --text='hint --custom '` | Hint a CSS selector |  |
| `;;` | bound | `cmdline.open --text='hint '` | Open the command line with hint |  |
| `;b` | bound | `hint --buttons` | Click button |  |
| `;a` | bound | `hint --every` | Click every element |  |
| `;p` | bound | `hint --prose` | Click text |  |
| `;s` | bound | `hint --focus --scrollable` | Focus scroll box |  |
| `;i` | bound | `hint --inputs` | Click input |  |
| `;l` | bound | `hint --links` | Click link |  |
| `;I` | bound | `hint --images` | Open image in new tab |  |
| `;yl` | bound | `hint --copy --links` | Copy link URL |  |
| `;yi` | bound | `hint --copy-image --images` | Copy picture |  |
| `;yI` | bound | `hint --copy --images` | Copy image URL |  |
| `;ym` | bound | `hint --copy --media` | Copy media URL |  |
| `;yf` | bound | `hint --copy --frames` | Copy frame URL |  |
| `;yt` | bound | `hint --copy-text --all` | Copy text |  |
| `;yc` | bound | `hint --copy-selector --every` | Copy CSS selector |  |
| `;yh` | bound | `hint --copy-html --every` | Copy outer HTML |  |
| `;f` | bound | `hint --frames` | Focus frame |  |
| `;m` | bound | `hint --media` | Play or pause media |  |
| `:` | bound | `cmdline.open` | Command line |  |
| `/` | bound | `find` | Find forward |  |
| `?` | bound | `find --backward` | Find backward |  |
| `*` | bound | `find --word` | Find word forward |  |
| `#` | bound | `find --backward --word` | Find word backward |  |
| `n` | bound | `find.next` | Next match |  |
| `N` | bound | `find.prev` | Previous match |  |
| `g?` | bound | `help` | Help |  |
| `gV` | bound | `mode caret` | Set mode |  |
| `M` | later | `quickmark.add` |  | phase 3, key param |
| `wi` | dropped |  |  | needs a shell |
| `<C-o>` | later | `page.jump --step=-1` |  | phase 3 |
| `<C-i>` | later | `page.jump --step=1` |  | phase 3 |
| `yq` | dropped |  |  | no longer planned |
| `gf` | dropped |  |  | no longer planned |
| `g!` | dropped |  |  | joke binding |
| `g;` | later | `page.change_jump` |  | phase 3 |
| `;c` | dropped |  |  | needs a shell |
| `;x` | dropped |  |  | needs a shell |
| `;:` | dropped |  |  | needs a shell |

Which-key group names:

- `g`: Go
- `gx`: Close tabs
- `d`: Close
- `x`: Stop or close
- `r`: Reload
- `>`: Move tab
- `t`: Tabs
- `w`: Windows
- `y`: Copy
- `b`: Bookmark
- `z`: Zoom and scroll
- `,`: DesertFox
- `;`: Hints
- `;y`: Yank
- `s`: Search here
- `S`: Search in new tab
- `s/`: Site search
- `S/`: Site search in new tab
- `c`: Reopen in container
- `C`: Open in container

### hint

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-[>` | bound | `mode.escape` | Escape |  |

### cmdline

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<Tab>` | bound | `cmdline.next_completion` | Next completion |  |
| `<C-n>` | bound | `cmdline.next_completion` | Next completion |  |
| `<A-ArrowDown>` | bound | `cmdline.next_completion` | Next completion |  |
| `<S-Tab>` | bound | `cmdline.prev_completion` | Previous completion |  |
| `<C-p>` | bound | `cmdline.prev_completion` | Previous completion |  |
| `<A-ArrowUp>` | bound | `cmdline.prev_completion` | Previous completion |  |
| `<Enter>` | bound | `cmdline.submit` | Submit |  |
| `<ArrowUp>` | bound | `cmdline.history prev` | History |  |
| `<ArrowDown>` | bound | `cmdline.history next` | History |  |
| `<C-u>` | bound | `cmdline.clear` | Clear line |  |
| `<C-h>` | bound | `cmdline.help` | Command help |  |
| `<A-u>` | bound | `list.act unload` | Unload or load the tab |  |
| `<C-Space>` | bound | `list.select toggle` | Mark or unmark the tab |  |
| `<A-x>` | bound | `list.act close` | Close the tab |  |
| `<A-m>` | bound | `list.act mute` | Mute or unmute the tab |  |
| `<A-p>` | bound | `list.act pin` | Pin or unpin the tab |  |
| `<A-c>` | bound | `list.act reopen` | Reopen the tab in a container |  |

### caret

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `0` | bound | `caret.move --line-start` | Move caret |  |
| `v` | bound | `mode visual` | Set mode |  |
| `V` | bound | `mode visual_line` | Start line visual mode |  |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-[>` | bound | `mode.escape` | Escape |  |
| `/` | bound | `find` | Find forward |  |
| `?` | bound | `find --backward` | Find backward |  |
| `*` | bound | `find --word` | Find word forward |  |
| `#` | bound | `find --backward --word` | Find word backward |  |
| `n` | bound | `find.next` | Next match |  |
| `N` | bound | `find.prev` | Previous match |  |
| `h` | bound | `caret.move --char --back` | Move caret |  |
| `l` | bound | `caret.move --char` | Move caret |  |
| `j` | bound | `caret.move --line` | Move caret |  |
| `k` | bound | `caret.move --line --back` | Move caret |  |
| `<ArrowLeft>` | bound | `caret.move --char --back` | Move caret |  |
| `<ArrowRight>` | bound | `caret.move --char` | Move caret |  |
| `<ArrowDown>` | bound | `caret.move --line` | Move caret |  |
| `<ArrowUp>` | bound | `caret.move --line --back` | Move caret |  |
| `w` | bound | `caret.move --word` | Move caret |  |
| `b` | bound | `caret.move --word --back` | Move caret |  |
| `e` | bound | `caret.move --word-end` | Move caret |  |
| `W` | bound | `caret.move --word --big` | Move caret by WORD |  |
| `B` | bound | `caret.move --word --back --big` | Move caret by WORD backward |  |
| `E` | bound | `caret.move --word-end --big` | Move caret to WORD end |  |
| `^` | bound | `caret.move --line-first` | Move caret |  |
| `$` | bound | `caret.move --line-end` | Move caret |  |
| `gg` | bound | `caret.move --start` | Move caret |  |
| `G` | bound | `caret.move --end` | Move caret |  |
| `f` | bound | `caret.move --char-find` | Move to a character |  |
| `t` | bound | `caret.move --char-find --till` | Move before a character |  |
| `F` | bound | `caret.move --char-find --back` | Move back to a character |  |
| `T` | bound | `caret.move --char-find --back --till` | Move back after a character |  |
| `;` | bound | `caret.move --find-repeat` | Repeat the character find |  |
| `,` | bound | `caret.move --find-repeat --back` | Repeat the character find backward |  |

### visual

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `0` | bound | `caret.move --line-start` | Move caret |  |
| `h` | bound | `caret.move --char --back` | Move caret |  |
| `l` | bound | `caret.move --char` | Move caret |  |
| `j` | bound | `caret.move --line` | Move caret |  |
| `k` | bound | `caret.move --line --back` | Move caret |  |
| `<ArrowLeft>` | bound | `caret.move --char --back` | Move caret |  |
| `<ArrowRight>` | bound | `caret.move --char` | Move caret |  |
| `<ArrowDown>` | bound | `caret.move --line` | Move caret |  |
| `<ArrowUp>` | bound | `caret.move --line --back` | Move caret |  |
| `w` | bound | `caret.move --word` | Move caret |  |
| `b` | bound | `caret.move --word --back` | Move caret |  |
| `e` | bound | `caret.move --word-end` | Move caret |  |
| `W` | bound | `caret.move --word --big` | Move caret by WORD |  |
| `B` | bound | `caret.move --word --back --big` | Move caret by WORD backward |  |
| `E` | bound | `caret.move --word-end --big` | Move caret to WORD end |  |
| `^` | bound | `caret.move --line-first` | Move caret |  |
| `$` | bound | `caret.move --line-end` | Move caret |  |
| `gg` | bound | `caret.move --start` | Move caret |  |
| `G` | bound | `caret.move --end` | Move caret |  |
| `f` | bound | `caret.move --char-find` | Move to a character |  |
| `t` | bound | `caret.move --char-find --till` | Move before a character |  |
| `F` | bound | `caret.move --char-find --back` | Move back to a character |  |
| `T` | bound | `caret.move --char-find --back --till` | Move back after a character |  |
| `;` | bound | `caret.move --find-repeat` | Repeat the character find |  |
| `,` | bound | `caret.move --find-repeat --back` | Repeat the character find backward |  |
| `/` | bound | `find` | Find forward |  |
| `?` | bound | `find --backward` | Find backward |  |
| `*` | bound | `find --word` | Find word forward |  |
| `#` | bound | `find --backward --word` | Find word backward |  |
| `n` | bound | `find.next` | Next match |  |
| `N` | bound | `find.prev` | Previous match |  |
| `y` | bound | `visual.act yank` | Act on selection |  |
| `o` | bound | `visual.act swap` | Act on selection |  |
| `s` | bound | `visual.act search` | Act on selection |  |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-[>` | bound | `mode.escape` | Escape |  |
| `V` | bound | `mode visual_line` | Switch to line visual mode |  |

### visual_line

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `0` | bound | `caret.move --line-start` | Move caret |  |
| `h` | bound | `caret.move --char --back` | Move caret |  |
| `l` | bound | `caret.move --char` | Move caret |  |
| `j` | bound | `caret.move --line` | Move caret |  |
| `k` | bound | `caret.move --line --back` | Move caret |  |
| `<ArrowLeft>` | bound | `caret.move --char --back` | Move caret |  |
| `<ArrowRight>` | bound | `caret.move --char` | Move caret |  |
| `<ArrowDown>` | bound | `caret.move --line` | Move caret |  |
| `<ArrowUp>` | bound | `caret.move --line --back` | Move caret |  |
| `w` | bound | `caret.move --word` | Move caret |  |
| `b` | bound | `caret.move --word --back` | Move caret |  |
| `e` | bound | `caret.move --word-end` | Move caret |  |
| `W` | bound | `caret.move --word --big` | Move caret by WORD |  |
| `B` | bound | `caret.move --word --back --big` | Move caret by WORD backward |  |
| `E` | bound | `caret.move --word-end --big` | Move caret to WORD end |  |
| `^` | bound | `caret.move --line-first` | Move caret |  |
| `$` | bound | `caret.move --line-end` | Move caret |  |
| `gg` | bound | `caret.move --start` | Move caret |  |
| `G` | bound | `caret.move --end` | Move caret |  |
| `f` | bound | `caret.move --char-find` | Move to a character |  |
| `t` | bound | `caret.move --char-find --till` | Move before a character |  |
| `F` | bound | `caret.move --char-find --back` | Move back to a character |  |
| `T` | bound | `caret.move --char-find --back --till` | Move back after a character |  |
| `;` | bound | `caret.move --find-repeat` | Repeat the character find |  |
| `,` | bound | `caret.move --find-repeat --back` | Repeat the character find backward |  |
| `/` | bound | `find` | Find forward |  |
| `?` | bound | `find --backward` | Find backward |  |
| `*` | bound | `find --word` | Find word forward |  |
| `#` | bound | `find --backward --word` | Find word backward |  |
| `n` | bound | `find.next` | Next match |  |
| `N` | bound | `find.prev` | Previous match |  |
| `y` | bound | `visual.act yank` | Act on selection |  |
| `o` | bound | `visual.act swap` | Act on selection |  |
| `s` | bound | `visual.act search` | Act on selection |  |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-[>` | bound | `mode.escape` | Escape |  |
| `v` | bound | `mode visual` | Switch to character visual mode |  |
| `V` | bound | `mode caret` | Return to caret mode |  |

### insert

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-r>` | bound | `register.paste` | Paste register |  |

### ignore

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `<S-Escape>` | bound | `mode normal` | Set mode |  |

### browser

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `<A-j>` | bound | `tab.next` | Next tab |  |
| `<A-k>` | bound | `tab.prev` | Previous tab |  |
| `<A-,>` | bound | `browser.focus_page` | Focus page |  |

<!-- END generated -->
