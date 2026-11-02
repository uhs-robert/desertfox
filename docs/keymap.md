# Binding map

Every key the owner binds in the current browser config (2026-10-30), with its status and the OasisFox invocation that replaces it. Search engine keywords move into the engine list as data and are not listed here.

Status values:

- `v1`: in the first release, phases 1 and 2.
- `later`: phase 3.
- `dropped`: not built. The last column gives the reason.

The shipped defaults bind every `v1` row whose command exists, with three kinds of exception:

- Rows that name a search engine or a container (`s`, `S`, `,`, `c`, `C` keys). The user's config generates them from `search_keys` and `container_keys`.
- `V`, because caret mode does not exist yet.
- `;f`, because `hint.run` has no link text param yet.

A note "(prompts)" means the binding leaves a param out, so the command line asks for it.

dropped: 8 | later: 15 | v1: 218

| mode | key | status | OasisFox |
| --- | --- | --- | --- |
| normal | `h` | v1 | `scroll.pixels dx=-50` |
| normal | `j` | v1 | `scroll.lines count=10` |
| normal | `k` | v1 | `scroll.lines count=-10` |
| normal | `l` | v1 | `scroll.pixels dx=50` |
| normal | `H` | v1 | `page.back` |
| normal | `J` | v1 | `tab.next` |
| normal | `K` | v1 | `tab.prev` |
| normal | `L` | v1 | `page.forward` |
| normal | `$` | v1 | `scroll.to percent=100 axis=x` |
| normal | `^` | v1 | `scroll.to percent=0 axis=x` |
| normal | `b` | v1 | `bookmark.open where=current` (prompts) |
| normal | `B` | v1 | `bookmark.open where=new_tab` (prompts) |
| normal | `f` | v1 | `hint.run action=open` |
| normal | `F` | v1 | `hint.run action=background` |
| normal | `m` | later | `mark.add` (key param) |
| normal | `M` | later | `quickmark.add` (key param) |
| normal | `o` | v1 | `open.url where=current` (prompts) |
| normal | `O` | v1 | `open.url where=new_tab` (prompts) |
| normal | `p` | v1 | `open.clipboard where=current` |
| normal | `P` | v1 | `open.clipboard where=new_tab` |
| normal | `R` | v1 | `page.reload hard=true` |
| normal | `T` | v1 | `tab.switch` (prompts for tab) |
| normal | `u` | v1 | `tab.undo_close` |
| normal | `U` | v1 | `window.undo_close` |
| normal | `v` | v1 | `hint.run action=select` (enters visual) |
| normal | `V` | v1 | `mode.set mode=caret` (then `v` selects) |
| normal | `.` | later | `command.repeat` |
| normal | `:` | v1 | `cmdline.open` |
| normal | `<<` | v1 | `tab.move offset=-1` |
| normal | `>>` | v1 | `tab.move offset=1` |
| normal | `[[` | later | `page.follow direction=prev` |
| normal | `[c` | later | `url.increment step=-1` |
| normal | `]]` | later | `page.follow direction=next` |
| normal | `]c` | later | `url.increment step=1` |
| normal | ``` | later | `mark.jump` (key param) |
| normal | `rr` | v1 | `page.reload` |
| normal | `rh` | v1 | `page.reload hard=true` |
| normal | `ri` | v1 | `site.isdown` |
| normal | `W` | v1 | `window.new` (prompts, url prefilled from current_url) |
| normal | `wa` | dropped | assumed unused |
| normal | `wc` | v1 | `window.close` |
| normal | `wd` | v1 | `tab.duplicate` |
| normal | `wD` | v1 | `tab.detach` |
| normal | `wh` | v1 | `hint.run action=new_window` |
| normal | `wi` | dropped | needs a shell (owner decision) |
| normal | `wn` | v1 | `window.new` |
| normal | `wo` | v1 | `window.new` (prompts for url) |
| normal | `wp` | v1 | `window.new private=true` |
| normal | `wu` | v1 | `window.undo_close` |
| normal | `ww` | v1 | `window.new` (prompts, url prefilled from current_url) |
| normal | `tt` | v1 | `open.url where=new_tab` (prompts) |
| normal | `tT` | v1 | `tab.switch` (prompts for tab) |
| normal | `td` | v1 | `tab.duplicate` |
| normal | `tm` | v1 | `tab.move` (prompts for offset) |
| normal | `tn` | v1 | `tab.next` |
| normal | `tp` | v1 | `tab.prev` |
| normal | `ta` | v1 | `tab.goto_audible` |
| normal | `tf` | v1 | `tab.goto index=1` |
| normal | `tl` | v1 | `tab.goto index=-1` |
| browser | `<A-,>` | v1 | `browser.focus_page` (Firefox shortcut slot) |
| browser | `<A-j>` | v1 | `tab.next` (Firefox shortcut slot, new in 0.1.1) |
| browser | `<A-k>` | v1 | `tab.prev` (Firefox shortcut slot, new in 0.1.1) |
| normal | `<S-Insert>` | v1 | `mode.set mode=ignore` |
| normal | `<AC-Escape>` | v1 | `mode.set mode=ignore` |
| normal | `<AC-`>` | v1 | `mode.set mode=ignore` |
| normal | `<S-Escape>` | v1 | `mode.set mode=ignore` |
| ignore | `<S-Escape>` | v1 | `mode.set mode=normal` (new in 0.1.1) |
| insert | `<Escape>` | v1 | `mode.escape` (new in 0.1.1) |
| normal | `<Escape>` | v1 | `mode.escape` |
| normal | `<C-[>` | v1 | `mode.escape` |
| normal | `<A-p>` | v1 | `tab.pin_toggle` |
| normal | `<A-m>` | v1 | `tab.mute_toggle` |
| normal | `<C-u>` | v1 | `scroll.pages fraction=-0.5` |
| normal | `<C-d>` | v1 | `scroll.pages fraction=0.5` |
| normal | `<C-f>` | v1 | `scroll.pages fraction=1` |
| normal | `<C-b>` | v1 | `scroll.pages fraction=-1` |
| normal | `<C-v>` | v1 | `mode.pass_next` |
| normal | `<C-o>` | later | `page.jump step=-1` |
| normal | `<C-i>` | later | `page.jump step=1` |
| normal | `<C-x>` | later | `url.increment step=-1` |
| normal | `<C-a>` | later | `url.increment step=1` |
| normal | `<F1>` | v1 | `help.open` |
| normal | `yc` | v1 | `copy.url format=canonical` |
| normal | `ym` | v1 | `copy.url format=markdown` |
| normal | `yo` | v1 | `copy.url format=org` |
| normal | `yq` | later | `copy.qr` |
| normal | `ys` | v1 | `copy.url format=short` |
| normal | `yt` | v1 | `copy.url format=title` |
| normal | `yy` | v1 | `copy.url format=plain` |
| normal | `ab` | v1 | `bookmark.add` (prompts, prefilled from current_url) |
| normal | `aa` | v1 | `bookmark.add` |
| normal | `ca` | v1 | `tab.reopen_in_container container=Family` |
| normal | `cA` | v1 | `open.url where=new_tab container=Family` (prompts, prefilled from current_url) |
| normal | `cc` | v1 | `tab.reopen_in_container container=Client` |
| normal | `cC` | v1 | `open.url where=new_tab container=Client` (prompts, prefilled from current_url) |
| normal | `cd` | v1 | `tab.reopen_in_container container=default` |
| normal | `cD` | v1 | `open.url where=new_tab container=default` (prompts, prefilled from current_url) |
| normal | `cn` | v1 | `tab.reopen_in_container container=No` |
| normal | `cN` | v1 | `open.url where=new_tab container=No` (prompts, prefilled from current_url) |
| normal | `cp` | v1 | `tab.reopen_in_container container=Personal` |
| normal | `cP` | v1 | `open.url where=new_tab container=Personal` (prompts, prefilled from current_url) |
| normal | `cr` | v1 | `tab.reopen_in_container container=Research` |
| normal | `cR` | v1 | `open.url where=new_tab container=Research` (prompts, prefilled from current_url) |
| normal | `cw` | v1 | `tab.reopen_in_container container=Work` |
| normal | `cW` | v1 | `open.url where=new_tab container=Work` (prompts, prefilled from current_url) |
| normal | `G` | v1 | `scroll.to percent=100` |
| normal | `ga` | v1 | `tab.goto_audible` |
| normal | `gg` | v1 | `scroll.to percent=0` |
| normal | `gf` | later | `page.view_source` |
| normal | `gh` | v1 | `page.home` |
| normal | `gH` | v1 | `page.home where=new_tab` |
| normal | `gi` | v1 | `page.focus_input` |
| normal | `go` | v1 | `open.url where=current` (prompts, prefilled from current_url) |
| normal | `gO` | v1 | `open.url where=new_tab` (prompts, prefilled from current_url) |
| normal | `gt` | v1 | `tab.goto` (count is the index) |
| normal | `gT` | v1 | `tab.prev` |
| normal | `gu` | v1 | `url.parent` |
| normal | `gU` | v1 | `url.root` |
| normal | `gx0` | v1 | `tab.close_side side=left` |
| normal | `gx$` | v1 | `tab.close_side side=right` |
| normal | `g!` | dropped | joke binding |
| normal | `g$` | v1 | `tab.goto index=-1` |
| normal | `g0` | v1 | `tab.goto index=1` |
| normal | `g;` | later | `page.change_jump` |
| normal | `g?` | v1 | `help.whichkey` |
| normal | `g^` | v1 | `tab.goto index=1` |
| normal | `dd` | v1 | `tab.close` |
| normal | `dL` | v1 | `tab.close_side side=right` |
| normal | `dH` | v1 | `tab.close_side side=left` |
| normal | `D` | v1 | `tab.close focus=left` |
| normal | `xx` | v1 | `tab.close` |
| normal | `xp` | v1 | `page.stop` |
| normal | `zi` | v1 | `zoom.by delta=0.1` |
| normal | `z+` | v1 | `zoom.by delta=0.1` |
| normal | `zI` | v1 | `zoom.set level=3` |
| normal | `zo` | v1 | `zoom.by delta=-0.1` |
| normal | `z-` | v1 | `zoom.by delta=-0.1` |
| normal | `zO` | dropped | duplicate key, the v1 `zO` row wins |
| normal | `zm` | v1 | `zoom.by delta=0.5` |
| normal | `zM` | v1 | `zoom.by delta=0.5` |
| normal | `zr` | v1 | `zoom.by delta=-0.5` |
| normal | `zR` | v1 | `zoom.by delta=-0.5` |
| normal | `zz` | v1 | `scroll.align position=center` (changed in 0.1.1, was zoom reset) |
| normal | `zt` | v1 | `scroll.align position=top` (new in 0.1.1) |
| normal | `z=` | v1 | `zoom.set level=1` (zoom reset moved here from `zz` in 0.1.1) |
| normal | `zO` | v1 | `zoom.set level=0.3` |
| normal | `qr` | v1 | `config.reload` (new in 0.1.1) |
| normal | `qh` | v1 | `help.open` (new in 0.1.1) |
| normal | `qi` | v1 | `mode.set mode=ignore` (new in 0.1.1) |
| normal | `qb` | v1 | `page.blur` (new in 0.1.1, moved from `zb`) |
| normal | `ZZ` | v1 | `browser.close_all` |
| normal | `zb` | v1 | `scroll.align position=bottom` (changed in 0.1.1, was blur) |
| normal | `;b` | v1 | `hint.run filter=clickable` |
| normal | `;B` | v1 | `hint.run action=background` |
| normal | `;c` | dropped | needs a shell (owner decision) |
| normal | `;f` | v1 | `hint.run action=open` (prompts for link text filter) |
| normal | `;i` | v1 | `hint.run filter=inputs` |
| normal | `;l` | v1 | `hint.run filter=links` |
| normal | `;x` | dropped | needs a shell (owner decision) |
| normal | `;:` | dropped | needs a shell (owner decision) |
| normal | `,,` | v1 | `open.search engine=search where=current` (prompts) |
| normal | `,<` | v1 | `open.search engine=search where=new_tab` (prompts) |
| normal | `,r` | dropped | no config file to reload |
| ex | `<A-ArrowDown>` | v1 | `cmdline.next_completion` (cmdline mode) |
| ex | `<A-ArrowUp>` | v1 | `cmdline.prev_completion` (cmdline mode) |
| normal | `sa` | v1 | `open.search engine=arch where=current` (prompts) |
| normal | `Sa` | v1 | `open.search engine=arch where=new_tab` (prompts) |
| normal | `sb` | v1 | `open.search engine=brave where=current` (prompts) |
| normal | `Sb` | v1 | `open.search engine=brave where=new_tab` (prompts) |
| normal | `sc` | v1 | `open.search engine=crates where=current` (prompts) |
| normal | `Sc` | v1 | `open.search engine=crates where=new_tab` (prompts) |
| normal | `sf` | v1 | `open.search engine=flathub where=current` (prompts) |
| normal | `Sf` | v1 | `open.search engine=flathub where=new_tab` (prompts) |
| normal | `sG` | v1 | `open.search engine=gh where=current` (prompts) |
| normal | `SG` | v1 | `open.search engine=gh where=new_tab` (prompts) |
| normal | `sh` | v1 | `open.search engine=hackernews where=current` (prompts) |
| normal | `Sh` | v1 | `open.search engine=hackernews where=new_tab` (prompts) |
| normal | `si` | v1 | `open.search engine=imdb where=current` (prompts) |
| normal | `Si` | v1 | `open.search engine=imdb where=new_tab` (prompts) |
| normal | `sm` | v1 | `open.search engine=mdn where=current` (prompts) |
| normal | `Sm` | v1 | `open.search engine=mdn where=new_tab` (prompts) |
| normal | `sn` | v1 | `open.search engine=npm where=current` (prompts) |
| normal | `Sn` | v1 | `open.search engine=npm where=new_tab` (prompts) |
| normal | `so` | v1 | `open.search engine=stackoverflow where=current` (prompts) |
| normal | `So` | v1 | `open.search engine=stackoverflow where=new_tab` (prompts) |
| normal | `sq` | v1 | `open.search engine=gpt where=current` (prompts) |
| normal | `Sq` | v1 | `open.search engine=gpt where=new_tab` (prompts) |
| normal | `sr` | v1 | `open.search engine=reddit where=current` (prompts) |
| normal | `Sr` | v1 | `open.search engine=reddit where=new_tab` (prompts) |
| normal | `ss` | v1 | `open.search engine=search where=current` (prompts) |
| normal | `Ss` | v1 | `open.search engine=search where=new_tab` (prompts) |
| normal | `st` | v1 | `open.search engine=translate where=current` (prompts) |
| normal | `St` | v1 | `open.search engine=translate where=new_tab` (prompts) |
| normal | `sw` | v1 | `open.search engine=wikipedia where=current` (prompts) |
| normal | `Sw` | v1 | `open.search engine=wikipedia where=new_tab` (prompts) |
| normal | `sy` | v1 | `open.search engine=youtube where=current` (prompts) |
| normal | `Sy` | v1 | `open.search engine=youtube where=new_tab` (prompts) |
| normal | `sz` | v1 | `open.search engine=wolframalpha where=current` (prompts) |
| normal | `Sz` | v1 | `open.search engine=wolframalpha where=new_tab` (prompts) |
| normal | `sgg` | v1 | `open.search engine=google where=current` (prompts) |
| normal | `Sgg` | v1 | `open.search engine=google where=new_tab` (prompts) |
| normal | `sgc` | v1 | `open.search engine=calendar where=current` (prompts) |
| normal | `Sgc` | v1 | `open.search engine=calendar where=new_tab` (prompts) |
| normal | `sgd` | v1 | `open.search engine=drive where=current` (prompts) |
| normal | `Sgd` | v1 | `open.search engine=drive where=new_tab` (prompts) |
| normal | `sge` | v1 | `open.search engine=gmail where=current` (prompts) |
| normal | `Sge` | v1 | `open.search engine=gmail where=new_tab` (prompts) |
| normal | `sgi` | v1 | `open.search engine=image where=current` (prompts) |
| normal | `Sgi` | v1 | `open.search engine=image where=new_tab` (prompts) |
| normal | `sgm` | v1 | `open.search engine=maps where=current` (prompts) |
| normal | `Sgm` | v1 | `open.search engine=maps where=new_tab` (prompts) |
| normal | `sgr` | v1 | `open.search engine=redditgoogle where=current` (prompts) |
| normal | `Sgr` | v1 | `open.search engine=redditgoogle where=new_tab` (prompts) |
| normal | `sgth` | v1 | `open.search engine=lasthour where=current` (prompts) |
| normal | `Sgth` | v1 | `open.search engine=lasthour where=new_tab` (prompts) |
| normal | `sgtd` | v1 | `open.search engine=lastday where=current` (prompts) |
| normal | `Sgtd` | v1 | `open.search engine=lastday where=new_tab` (prompts) |
| normal | `sgtw` | v1 | `open.search engine=lastweek where=current` (prompts) |
| normal | `Sgtw` | v1 | `open.search engine=lastweek where=new_tab` (prompts) |
| normal | `sgtm` | v1 | `open.search engine=lastmonth where=current` (prompts) |
| normal | `Sgtm` | v1 | `open.search engine=lastmonth where=new_tab` (prompts) |
| normal | `sgty` | v1 | `open.search engine=lastyear where=current` (prompts) |
| normal | `Sgty` | v1 | `open.search engine=lastyear where=new_tab` (prompts) |
| normal | `sdd` | v1 | `open.search engine=duck where=current` (prompts) |
| normal | `Sdd` | v1 | `open.search engine=duck where=new_tab` (prompts) |
| normal | `sde` | v1 | `open.search engine=define where=current` (prompts) |
| normal | `Sde` | v1 | `open.search engine=define where=new_tab` (prompts) |
| normal | `sdu` | v1 | `open.search engine=urbandictionary where=current` (prompts) |
| normal | `Sdu` | v1 | `open.search engine=urbandictionary where=new_tab` (prompts) |
| normal | `sdy` | v1 | `open.search engine=synonym where=current` (prompts) |
| normal | `Sdy` | v1 | `open.search engine=synonym where=new_tab` (prompts) |
| normal | `sea` | v1 | `open.search engine=amazon where=current` (prompts) |
| normal | `Sea` | v1 | `open.search engine=amazon where=new_tab` (prompts) |
| normal | `spb` | v1 | `open.search engine=gamebanana where=current` (prompts) |
| normal | `Spb` | v1 | `open.search engine=gamebanana where=new_tab` (prompts) |
| normal | `spn` | v1 | `open.search engine=nexusmods where=current` (prompts) |
| normal | `Spn` | v1 | `open.search engine=nexusmods where=new_tab` (prompts) |
| normal | `spp` | v1 | `open.search engine=proton where=current` (prompts) |
| normal | `Spp` | v1 | `open.search engine=proton where=new_tab` (prompts) |
| normal | `sps` | v1 | `open.search engine=steam where=current` (prompts) |
| normal | `Sps` | v1 | `open.search engine=steam where=new_tab` (prompts) |
