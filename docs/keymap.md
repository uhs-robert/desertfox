# Binding map

The default keymap, generated from `src/background/default_keymap.ts` and `docs/keymap_planned.toml`. Do not edit between the markers. Run `just docs-gen` after a change to either source. `npm test` fails when the tables are stale.

Status values:

- `bound`: the default keymap binds the key.
- `later`: planned for phase 3. The key is not bound yet.
- `dropped`: not built. The note gives the reason.

Search engine keys (`s`, `S`, `,`) and container keys (`c`, `C`) come from the user's config, so no row lists them. The config generates them from `search_keys` and `container_keys`. Two defaults are left unbound on purpose. `;f` needs the command line prompt to ask for the link text, and `hint.run --text=...` already filters. `ZZ` closes every window with no undo, so users bind it in their config.

Which-key shows a group as `+Name`, for example `g` as `+Go`. A `group_names` section in `keymap.toml` maps a key sequence to its name. A group without one shows its prefix key.

A key shows the command label plus a phrase for each arg its binding sets, for example `gO` as "Open URL in new tab". Keys that set numbers carry a `label` in the default keymap, such as `h` as "Scroll left". The Label column shows that `label` or the command label. The rule is in [design.md](design.md#which-key).

The `caret`, `visual` and `cmdline` rows bind placeholder commands that refuse until their piece builds them.

A note "(prompts)" means the binding leaves a param out, so the command line asks for it.

<!-- BEGIN generated -->

bound: 184 (normal 128, hint 2, cmdline 11, caret 18, visual 20, insert 1, ignore 1, browser 3) | later: 14 | dropped: 6

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
| `<C-d>` | bound | `scroll.pages 0.5` | Scroll half page down |  |
| `<C-u>` | bound | `scroll.pages -0.5` | Scroll half page up |  |
| `<C-f>` | bound | `scroll.pages` | Scroll page down |  |
| `<C-b>` | bound | `scroll.pages -1` | Scroll page up |  |
| `H` | bound | `page.back` | Back |  |
| `L` | bound | `page.forward` | Forward |  |
| `rr` | bound | `page.reload` | Reload |  |
| `rh` | bound | `page.reload --hard` | Hard reload |  |
| `R` | bound | `page.reload --hard` | Hard reload |  |
| `xp` | bound | `page.stop` | Stop loading |  |
| `gh` | bound | `page.home` | Home page |  |
| `gH` | bound | `page.home --tab` | Home page |  |
| `.` | bound | `repeat` | Repeat |  |
| `J` | bound | `tab.next` | Next tab |  |
| `K` | bound | `tab.prev` | Previous tab |  |
| `gt` | bound | `tab.goto` | Next tab |  |
| `gT` | bound | `tab.prev` | Previous tab |  |
| `ga` | bound | `tab.goto_audible` | Go to audible tab |  |
| `g0` | bound | `tab.goto 1` | First tab |  |
| `g^` | bound | `tab.goto 1` | First tab |  |
| `g$` | bound | `tab.goto -1` | Last tab |  |
| `T` | bound | `tab` (prompts) | Switch tab |  |
| `<<` | bound | `tab.move -1` | Move tab left |  |
| `>>` | bound | `tab.move 1` | Move tab right |  |
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
| `td` | bound | `tab.duplicate` | Duplicate tab |  |
| `tm` | bound | `tab.move` (prompts) | Move tab |  |
| `tn` | bound | `tab.next` | Next tab |  |
| `tp` | bound | `tab.prev` | Previous tab |  |
| `ta` | bound | `tab.goto_audible` | Go to audible tab |  |
| `tf` | bound | `tab.goto 1` | First tab |  |
| `tl` | bound | `tab.goto -1` | Last tab |  |
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
| `gu` | bound | `url.parent` | Parent URL |  |
| `gU` | bound | `url.root` | Root URL |  |
| `gi` | bound | `page.focus_input` | Focus input |  |
| `p` | bound | `paste` | Open clipboard |  |
| `P` | bound | `paste --tab` | Open clipboard |  |
| `aa` | bound | `bookmark.add` | Add bookmark |  |
| `ab` | bound | `bookmark.add` (prompts) | Add bookmark, edit URL |  |
| `b` | bound | `bookmark` (prompts) | Open bookmark |  |
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
| `qr` | bound | `config.reload` | Reload config |  |
| `qh` | bound | `help` | Help |  |
| `qi` | bound | `mode ignore` | Set mode |  |
| `qb` | bound | `page.blur` | Blur |  |
| `o` | bound | `open` (prompts) | Open URL |  |
| `O` | bound | `open --tab` (prompts) | Open URL |  |
| `go` | bound | `open` (prompts) | Open URL |  |
| `gO` | bound | `open --tab` (prompts) | Open URL |  |
| `f` | bound | `hint` | Click element |  |
| `F` | bound | `hint --background` | Click element in background tab |  |
| `v` | bound | `mode caret` | Start caret mode |  |
| `V` | bound | `mode visual` | Start visual mode |  |
| `;v` | bound | `hint --caret --all` | Start caret mode at element |  |
| `;V` | bound | `hint --visual --all` | Start visual mode at element |  |
| `;;` | bound | `cmdline.open --text='hint '` | Open the command line with hint |  |
| `;b` | bound | `hint` | Click element |  |
| `;B` | bound | `hint --background` | Click element in background tab |  |
| `;y` | bound | `hint --copy --links` | Copy link address |  |
| `;r` | bound | `hint --background --links --rapid` | Open links rapidly in background tabs |  |
| `;i` | bound | `hint --inputs` | Click input |  |
| `;l` | bound | `hint --links` | Click link |  |
| `:` | bound | `cmdline.open` | Command line |  |
| `/` | bound | `find.open` | Find forward |  |
| `?` | bound | `find.open --backward` | Find backward |  |
| `n` | bound | `find.next` | Next match |  |
| `N` | bound | `find.prev` | Previous match |  |
| `g?` | bound | `help` | Help |  |
| `gV` | bound | `mode caret` | Set mode |  |
| `m` | later | `mark.add` |  | phase 3, key param |
| `M` | later | `quickmark.add` |  | phase 3, key param |
| `[[` | later | `page.follow --direction=prev` |  | phase 3 |
| `[c` | later | `url.increment --step=-1` |  | phase 3 |
| `]]` | later | `page.follow --direction=next` |  | phase 3 |
| `]c` | later | `url.increment --step=1` |  | phase 3 |
| `` ` `` | later | `mark.jump` |  | phase 3, key param |
| `wi` | dropped |  |  | needs a shell |
| `<C-o>` | later | `page.jump --step=-1` |  | phase 3 |
| `<C-i>` | later | `page.jump --step=1` |  | phase 3 |
| `<C-x>` | later | `url.increment --step=-1` |  | phase 3 |
| `<C-a>` | later | `url.increment --step=1` |  | phase 3 |
| `yq` | later | `copy.qr` |  | phase 3 |
| `gf` | later | `page.view_source` |  | phase 3 |
| `g!` | dropped |  |  | joke binding |
| `g;` | later | `page.change_jump` |  | phase 3 |
| `;c` | dropped |  |  | needs a shell |
| `;x` | dropped |  |  | needs a shell |
| `;:` | dropped |  |  | needs a shell |
| `,r` | dropped |  |  | no config file to reload |

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
- `a`: Bookmark
- `z`: Zoom and scroll
- `q`: OasisFox
- `;`: Hints
- `s`: Search here
- `S`: Search in new tab
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

### caret

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `0` | bound | `caret.move --line-start` | Move caret |  |
| `v` | bound | `mode visual` | Set mode |  |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-[>` | bound | `mode.escape` | Escape |  |
| `h` | bound | `caret.move --char --back` | Move caret |  |
| `l` | bound | `caret.move --char` | Move caret |  |
| `j` | bound | `caret.move --line` | Move caret |  |
| `k` | bound | `caret.move --line --back` | Move caret |  |
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

### visual

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `0` | bound | `caret.move --line-start` | Move caret |  |
| `h` | bound | `caret.move --char --back` | Move caret |  |
| `l` | bound | `caret.move --char` | Move caret |  |
| `j` | bound | `caret.move --line` | Move caret |  |
| `k` | bound | `caret.move --line --back` | Move caret |  |
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
| `y` | bound | `visual.act yank` | Act on selection |  |
| `o` | bound | `visual.act swap` | Act on selection |  |
| `s` | bound | `visual.act search` | Act on selection |  |
| `<Escape>` | bound | `mode.escape` | Escape |  |
| `<C-[>` | bound | `mode.escape` | Escape |  |

### insert

| Key | Status | Command | Label | Note |
| --- | --- | --- | --- | --- |
| `<Escape>` | bound | `mode.escape` | Escape |  |

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
