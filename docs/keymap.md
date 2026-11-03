# Binding map

Every key bound in the current browser config (2026-10-30), with its status and the OasisFox invocation that replaces it. Search engine keywords move into the engine list as data and are not listed here.

Status values:

- `v1`: in the first release, phases 1 and 2.
- `later`: phase 3.
- `dropped`: not built. The last column gives the reason.

The shipped defaults bind every `v1` row whose command exists, with three kinds of exception:

- Rows that name a search engine or a container (`s`, `S`, `,`, `c`, `C` keys). The user's config generates them from `search_keys` and `container_keys`. The `s/` and `sG` site search rows are the exception and ship as defaults.
- `;f`, because it needs the command line prompt to ask for the link text. `hint.run --text=...` already filters.
- `ZZ`, because closing every window cannot be undone. Bind it in the config.

Which-key shows a group as `+Name`, for example `g` as `+Go`. A `group_names` section in `keymap.toml` maps a key sequence to its name. A group without one shows its prefix key.

A key shows the command label plus a phrase for each arg its binding sets, for example `gO` as "Open URL in new tab". Keys that set numbers carry a `label` in the default keymap, such as `h` as "Scroll left". The rule is in [design.md](design.md#which-key).

The `caret`, `visual` and `cmdline` rows bind placeholder commands that refuse until their piece builds them.

A note "(prompts)" means the binding leaves a param out, so the command line asks for it.

dropped: 8 | later: 15 | v1: 269

| mode | key | status | OasisFox |
| --- | --- | --- | --- |
| normal | `h` | v1 | `scroll.pixels --dx=-50` |
| normal | `j` | v1 | `scroll.lines 10` |
| normal | `k` | v1 | `scroll.lines -10` |
| normal | `l` | v1 | `scroll.pixels --dx=50` |
| normal | `H` | v1 | `page.back` |
| normal | `J` | v1 | `tab.next` |
| normal | `K` | v1 | `tab.prev` |
| normal | `L` | v1 | `page.forward` |
| normal | `$` | v1 | `scroll.to --x 100` |
| normal | `^` | v1 | `scroll.to --x 0` |
| normal | `b` | v1 | `bookmark.open` (prompts) |
| normal | `B` | v1 | `bookmark.open --tab` (prompts) |
| normal | `f` | v1 | `hint.run` |
| normal | `F` | v1 | `hint.run --background` |
| normal | `m` | later | `mark.add` (key param) |
| normal | `M` | later | `quickmark.add` (key param) |
| normal | `o` | v1 | `open.url` (prompts) |
| normal | `O` | v1 | `open.url --tab` (prompts) |
| normal | `p` | v1 | `open.clipboard` |
| normal | `P` | v1 | `open.clipboard --tab` |
| normal | `R` | v1 | `page.reload --hard` |
| normal | `T` | v1 | `tab.switch` (prompts for tab) |
| normal | `u` | v1 | `tab.undo_close` |
| normal | `U` | v1 | `window.undo_close` |
| normal | `v` | v1 | `hint.run --select` (enters visual) |
| normal | `V` | v1 | `mode.set caret` (then `v` selects, new in phase 2) |
| normal | `.` | later | `command.repeat` |
| normal | `:` | v1 | `cmdline.open` |
| normal | `<<` | v1 | `tab.move -1` |
| normal | `>>` | v1 | `tab.move 1` |
| normal | `[[` | later | `page.follow --direction=prev` |
| normal | `[c` | later | `url.increment --step=-1` |
| normal | `]]` | later | `page.follow --direction=next` |
| normal | `]c` | later | `url.increment --step=1` |
| normal | ``` | later | `mark.jump` (key param) |
| normal | `rr` | v1 | `page.reload` |
| normal | `rh` | v1 | `page.reload --hard` |
| normal | `ri` | v1 | `site.isdown` |
| normal | `s/` | v1 | `site.search @selection` (prompts when nothing is selected) |
| normal | `sGc` | v1 | `site.github @selection` (prompts when nothing is selected) |
| normal | `sGi` | v1 | `site.github --issues @selection` |
| normal | `sGp` | v1 | `site.github --pullrequests @selection` |
| normal | `sGm` | v1 | `site.github --commits @selection` |
| normal | `sGd` | v1 | `site.github --discussions @selection` |
| normal | `sGr` | v1 | `site.github --repositories @selection` |
| normal | `sGu` | v1 | `site.github --users @selection` |
| normal | `sGs` | v1 | `site.github --any --all @selection` (GitHub picks the result type) |
| normal | `W` | v1 | `window.new` (prompts, url prefilled from current_url) |
| normal | `wa` | dropped | assumed unused |
| normal | `wc` | v1 | `window.close` |
| normal | `wd` | v1 | `tab.duplicate` |
| normal | `wD` | v1 | `tab.detach` |
| normal | `wh` | v1 | `hint.run --window` |
| normal | `wi` | dropped | needs a shell |
| normal | `wn` | v1 | `window.new` |
| normal | `wo` | v1 | `window.new` (prompts for url) |
| normal | `wp` | v1 | `window.new --private` |
| normal | `wu` | v1 | `window.undo_close` |
| normal | `ww` | v1 | `window.new` (prompts, url prefilled from current_url) |
| normal | `tt` | v1 | `open.url --tab` (prompts) |
| normal | `tT` | v1 | `tab.switch` (prompts for tab) |
| normal | `td` | v1 | `tab.duplicate` |
| normal | `tm` | v1 | `tab.move` (prompts for offset) |
| normal | `tn` | v1 | `tab.next` |
| normal | `tp` | v1 | `tab.prev` |
| normal | `ta` | v1 | `tab.goto_audible` |
| normal | `tf` | v1 | `tab.goto 1` |
| normal | `tl` | v1 | `tab.goto -1` |
| browser | `<A-,>` | v1 | `browser.focus_page` (Firefox shortcut slot) |
| browser | `<A-j>` | v1 | `tab.next` (Firefox shortcut slot, new in 0.1.1) |
| browser | `<A-k>` | v1 | `tab.prev` (Firefox shortcut slot, new in 0.1.1) |
| normal | `<S-Insert>` | v1 | `mode.set ignore` |
| normal | `<AC-Escape>` | v1 | `mode.set ignore` |
| normal | `<AC-`>` | v1 | `mode.set ignore` |
| normal | `<S-Escape>` | v1 | `mode.set ignore` |
| ignore | `<S-Escape>` | v1 | `mode.set normal` (new in 0.1.1) |
| insert | `<Escape>` | v1 | `mode.escape` (new in 0.1.1) |
| normal | `<Escape>` | v1 | `mode.escape` |
| normal | `<C-[>` | v1 | `mode.escape` |
| normal | `<A-p>` | v1 | `tab.pin` |
| normal | `<A-m>` | v1 | `tab.mute` |
| normal | `<C-u>` | v1 | `scroll.pages -0.5` |
| normal | `<C-d>` | v1 | `scroll.pages 0.5` |
| normal | `<C-f>` | v1 | `scroll.pages` |
| normal | `<C-b>` | v1 | `scroll.pages -1` |
| normal | `<C-v>` | v1 | `mode.pass_next` |
| normal | `<C-o>` | later | `page.jump --step=-1` |
| normal | `<C-i>` | later | `page.jump --step=1` |
| normal | `<C-x>` | later | `url.increment --step=-1` |
| normal | `<C-a>` | later | `url.increment --step=1` |
| normal | `<F1>` | v1 | `help.open` |
| normal | `yc` | v1 | `copy.url --canonical` |
| normal | `ym` | v1 | `copy.url --markdown` |
| normal | `yo` | v1 | `copy.url --org` |
| normal | `yq` | later | `copy.qr` |
| normal | `ys` | v1 | `copy.url --short` |
| normal | `yt` | v1 | `copy.url --title` |
| normal | `yy` | v1 | `copy.url` |
| normal | `ab` | v1 | `bookmark.add` (prompts, prefilled from current_url) |
| normal | `aa` | v1 | `bookmark.add` |
| normal | `ca` | v1 | `tab.reopen_in_container Family` |
| normal | `cA` | v1 | `open.url --tab --container=Family` (prompts, prefilled from current_url) |
| normal | `cc` | v1 | `tab.reopen_in_container Client` |
| normal | `cC` | v1 | `open.url --tab --container=Client` (prompts, prefilled from current_url) |
| normal | `cd` | v1 | `tab.reopen_in_container default` |
| normal | `cD` | v1 | `open.url --tab --container=default` (prompts, prefilled from current_url) |
| normal | `cn` | v1 | `tab.reopen_in_container No` |
| normal | `cN` | v1 | `open.url --tab --container=No` (prompts, prefilled from current_url) |
| normal | `cp` | v1 | `tab.reopen_in_container Personal` |
| normal | `cP` | v1 | `open.url --tab --container=Personal` (prompts, prefilled from current_url) |
| normal | `cr` | v1 | `tab.reopen_in_container Research` |
| normal | `cR` | v1 | `open.url --tab --container=Research` (prompts, prefilled from current_url) |
| normal | `cw` | v1 | `tab.reopen_in_container Work` |
| normal | `cW` | v1 | `open.url --tab --container=Work` (prompts, prefilled from current_url) |
| normal | `G` | v1 | `scroll.to 100` |
| normal | `ga` | v1 | `tab.goto_audible` |
| normal | `gg` | v1 | `scroll.to 0` |
| normal | `gf` | later | `page.view_source` |
| normal | `gh` | v1 | `page.home` |
| normal | `gH` | v1 | `page.home --tab` |
| normal | `gi` | v1 | `page.focus_input` |
| normal | `go` | v1 | `open.url` (prompts, prefilled from current_url) |
| normal | `gO` | v1 | `open.url --tab` (prompts, prefilled from current_url) |
| normal | `gt` | v1 | `tab.goto` (count is the index) |
| normal | `gT` | v1 | `tab.prev` |
| normal | `gu` | v1 | `url.parent` |
| normal | `gU` | v1 | `url.root` |
| normal | `gx0` | v1 | `tab.close --all-before` |
| normal | `gx$` | v1 | `tab.close --all-after` |
| normal | `g!` | dropped | joke binding |
| normal | `g$` | v1 | `tab.goto -1` |
| normal | `g0` | v1 | `tab.goto 1` |
| normal | `g;` | later | `page.change_jump` |
| normal | `g?` | v1 | `help.open` |
| normal | `g^` | v1 | `tab.goto 1` |
| normal | `dd` | v1 | `tab.close` |
| normal | `dL` | v1 | `tab.close --all-after` |
| normal | `dH` | v1 | `tab.close --all-before` |
| normal | `D` | v1 | `tab.close --focus-previous` |
| normal | `xx` | v1 | `tab.close` |
| normal | `xp` | v1 | `page.stop` |
| normal | `zi` | v1 | `zoom.by 0.1` |
| normal | `z+` | v1 | `zoom.by 0.1` |
| normal | `zI` | v1 | `zoom.set 3` |
| normal | `zo` | v1 | `zoom.by -0.1` |
| normal | `z-` | v1 | `zoom.by -0.1` |
| normal | `zO` | dropped | duplicate key, the v1 `zO` row wins |
| normal | `zm` | v1 | `zoom.by 0.5` |
| normal | `zM` | v1 | `zoom.by 0.5` |
| normal | `zr` | v1 | `zoom.by -0.5` |
| normal | `zR` | v1 | `zoom.by -0.5` |
| normal | `zz` | v1 | `scroll.align` (changed in 0.1.1, was zoom reset) |
| normal | `zt` | v1 | `scroll.align --top` (new in 0.1.1) |
| normal | `z=` | v1 | `zoom.set 1` (zoom reset moved here from `zz` in 0.1.1) |
| normal | `zO` | v1 | `zoom.set 0.3` |
| normal | `qr` | v1 | `config.reload` (new in 0.1.1) |
| normal | `qh` | v1 | `help.open` (new in 0.1.1) |
| normal | `qi` | v1 | `mode.set ignore` (new in 0.1.1) |
| normal | `qb` | v1 | `page.blur` (new in 0.1.1, moved from `zb`) |
| normal | `ZZ` | v1 | `browser.close_all` (config only: closing every window cannot be undone, so no default key) |
| normal | `zb` | v1 | `scroll.align --bottom` (changed in 0.1.1, was blur) |
| normal | `;b` | v1 | `hint.run` |
| normal | `;B` | v1 | `hint.run --background` |
| normal | `;r` | v1 | `hint.run --background --links --rapid` |
| normal | `;c` | dropped | needs a shell |
| normal | `;f` | v1 | `hint.run` (prompts for link text filter) |
| normal | `;i` | v1 | `hint.run --inputs` |
| normal | `;l` | v1 | `hint.run --links` |
| normal | `;y` | v1 | `hint.run --copy --links` (copies the link address, `--copy-text` copies its text) |
| normal | `;x` | dropped | needs a shell |
| normal | `;:` | dropped | needs a shell |
| normal | `,,` | v1 | `open.search search` (prompts) |
| normal | `,<` | v1 | `open.search search --tab` (prompts) |
| normal | `,r` | dropped | no config file to reload |
| cmdline | `<A-ArrowDown>` | v1 | `cmdline.next_completion` |
| cmdline | `<A-ArrowUp>` | v1 | `cmdline.prev_completion` |
| cmdline | `<Tab>` | v1 | `cmdline.next_completion` (new in phase 2) |
| cmdline | `<C-n>` | v1 | `cmdline.next_completion` (new in phase 2) |
| cmdline | `<S-Tab>` | v1 | `cmdline.prev_completion` (new in phase 2) |
| cmdline | `<C-p>` | v1 | `cmdline.prev_completion` (new in phase 2) |
| cmdline | `<Escape>` | v1 | `mode.escape` (new in phase 2) |
| caret | `h` | v1 | `caret.move --char --back` (new in phase 2) |
| caret | `l` | v1 | `caret.move --char` (new in phase 2) |
| caret | `j` | v1 | `caret.move --line` (new in phase 2) |
| caret | `k` | v1 | `caret.move --line --back` (new in phase 2) |
| caret | `w` | v1 | `caret.move --word` (new in phase 2) |
| caret | `b` | v1 | `caret.move --word --back` (new in phase 2) |
| caret | `e` | v1 | `caret.move --word-end` (new in phase 2) |
| caret | `W` | v1 | `caret.move --word --big` (new in phase 2) |
| caret | `B` | v1 | `caret.move --word --back --big` (new in phase 2) |
| caret | `E` | v1 | `caret.move --word-end --big` (new in phase 2) |
| caret | `0` | v1 | `caret.move --line-start` (new in phase 2) |
| caret | `^` | v1 | `caret.move --line-first` (new in phase 2) |
| caret | `$` | v1 | `caret.move --line-end` (new in phase 2) |
| caret | `gg` | v1 | `caret.move --start` (new in phase 2) |
| caret | `G` | v1 | `caret.move --end` (new in phase 2) |
| visual | `h` | v1 | `caret.move --char --back` (new in phase 2) |
| visual | `l` | v1 | `caret.move --char` (new in phase 2) |
| visual | `j` | v1 | `caret.move --line` (new in phase 2) |
| visual | `k` | v1 | `caret.move --line --back` (new in phase 2) |
| visual | `w` | v1 | `caret.move --word` (new in phase 2) |
| visual | `b` | v1 | `caret.move --word --back` (new in phase 2) |
| visual | `e` | v1 | `caret.move --word-end` (new in phase 2) |
| visual | `W` | v1 | `caret.move --word --big` (new in phase 2) |
| visual | `B` | v1 | `caret.move --word --back --big` (new in phase 2) |
| visual | `E` | v1 | `caret.move --word-end --big` (new in phase 2) |
| visual | `0` | v1 | `caret.move --line-start` (new in phase 2) |
| visual | `^` | v1 | `caret.move --line-first` (new in phase 2) |
| visual | `$` | v1 | `caret.move --line-end` (new in phase 2) |
| visual | `gg` | v1 | `caret.move --start` (new in phase 2) |
| visual | `G` | v1 | `caret.move --end` (new in phase 2) |
| visual | `y` | v1 | `visual.act yank` (new in phase 2) |
| visual | `o` | v1 | `visual.act swap` (new in phase 2) |
| visual | `s` | v1 | `visual.act search` (new in phase 2) |
| cmdline | `<Enter>` | v1 | `cmdline.submit` (new in phase 2) |
| cmdline | `<ArrowUp>` | v1 | `cmdline.history prev` (new in phase 2) |
| cmdline | `<ArrowDown>` | v1 | `cmdline.history next` (new in phase 2) |
| cmdline | `<C-u>` | v1 | `cmdline.clear` (new in phase 2) |
| hint | `<Escape>` | v1 | `mode.escape` (new in phase 2) |
| hint | `<C-[>` | v1 | `mode.escape` (new in phase 2) |
| caret | `v` | v1 | `mode.set visual` (new in phase 2) |
| caret | `<Escape>` | v1 | `mode.escape` (new in phase 2) |
| caret | `<C-[>` | v1 | `mode.escape` (new in phase 2) |
| visual | `<Escape>` | v1 | `mode.escape` (new in phase 2) |
| visual | `<C-[>` | v1 | `mode.escape` (new in phase 2) |
| normal | `sa` | v1 | `open.search arch` (prompts) |
| normal | `Sa` | v1 | `open.search arch --tab` (prompts) |
| normal | `sb` | v1 | `open.search brave` (prompts) |
| normal | `Sb` | v1 | `open.search brave --tab` (prompts) |
| normal | `sc` | v1 | `open.search crates` (prompts) |
| normal | `Sc` | v1 | `open.search crates --tab` (prompts) |
| normal | `sf` | v1 | `open.search flathub` (prompts) |
| normal | `Sf` | v1 | `open.search flathub --tab` (prompts) |
| normal | `sh` | v1 | `open.search hackernews` (prompts) |
| normal | `Sh` | v1 | `open.search hackernews --tab` (prompts) |
| normal | `si` | v1 | `open.search imdb` (prompts) |
| normal | `Si` | v1 | `open.search imdb --tab` (prompts) |
| normal | `sm` | v1 | `open.search mdn` (prompts) |
| normal | `Sm` | v1 | `open.search mdn --tab` (prompts) |
| normal | `sn` | v1 | `open.search npm` (prompts) |
| normal | `Sn` | v1 | `open.search npm --tab` (prompts) |
| normal | `so` | v1 | `open.search stackoverflow` (prompts) |
| normal | `So` | v1 | `open.search stackoverflow --tab` (prompts) |
| normal | `sq` | v1 | `open.search gpt` (prompts) |
| normal | `Sq` | v1 | `open.search gpt --tab` (prompts) |
| normal | `sr` | v1 | `open.search reddit` (prompts) |
| normal | `Sr` | v1 | `open.search reddit --tab` (prompts) |
| normal | `ss` | v1 | `open.search search` (prompts) |
| normal | `Ss` | v1 | `open.search search --tab` (prompts) |
| normal | `st` | v1 | `open.search translate` (prompts) |
| normal | `St` | v1 | `open.search translate --tab` (prompts) |
| normal | `sw` | v1 | `open.search wikipedia` (prompts) |
| normal | `Sw` | v1 | `open.search wikipedia --tab` (prompts) |
| normal | `sy` | v1 | `open.search youtube` (prompts) |
| normal | `Sy` | v1 | `open.search youtube --tab` (prompts) |
| normal | `sz` | v1 | `open.search wolframalpha` (prompts) |
| normal | `Sz` | v1 | `open.search wolframalpha --tab` (prompts) |
| normal | `sgg` | v1 | `open.search google` (prompts) |
| normal | `Sgg` | v1 | `open.search google --tab` (prompts) |
| normal | `sgc` | v1 | `open.search calendar` (prompts) |
| normal | `Sgc` | v1 | `open.search calendar --tab` (prompts) |
| normal | `sgd` | v1 | `open.search drive` (prompts) |
| normal | `Sgd` | v1 | `open.search drive --tab` (prompts) |
| normal | `sge` | v1 | `open.search gmail` (prompts) |
| normal | `Sge` | v1 | `open.search gmail --tab` (prompts) |
| normal | `sgi` | v1 | `open.search image` (prompts) |
| normal | `Sgi` | v1 | `open.search image --tab` (prompts) |
| normal | `sgm` | v1 | `open.search maps` (prompts) |
| normal | `Sgm` | v1 | `open.search maps --tab` (prompts) |
| normal | `sgr` | v1 | `open.search redditgoogle` (prompts) |
| normal | `Sgr` | v1 | `open.search redditgoogle --tab` (prompts) |
| normal | `sgth` | v1 | `open.search lasthour` (prompts) |
| normal | `Sgth` | v1 | `open.search lasthour --tab` (prompts) |
| normal | `sgtd` | v1 | `open.search lastday` (prompts) |
| normal | `Sgtd` | v1 | `open.search lastday --tab` (prompts) |
| normal | `sgtw` | v1 | `open.search lastweek` (prompts) |
| normal | `Sgtw` | v1 | `open.search lastweek --tab` (prompts) |
| normal | `sgtm` | v1 | `open.search lastmonth` (prompts) |
| normal | `Sgtm` | v1 | `open.search lastmonth --tab` (prompts) |
| normal | `sgty` | v1 | `open.search lastyear` (prompts) |
| normal | `Sgty` | v1 | `open.search lastyear --tab` (prompts) |
| normal | `sdd` | v1 | `open.search duck` (prompts) |
| normal | `Sdd` | v1 | `open.search duck --tab` (prompts) |
| normal | `sde` | v1 | `open.search define` (prompts) |
| normal | `Sde` | v1 | `open.search define --tab` (prompts) |
| normal | `sdu` | v1 | `open.search urbandictionary` (prompts) |
| normal | `Sdu` | v1 | `open.search urbandictionary --tab` (prompts) |
| normal | `sdy` | v1 | `open.search synonym` (prompts) |
| normal | `Sdy` | v1 | `open.search synonym --tab` (prompts) |
| normal | `sea` | v1 | `open.search amazon` (prompts) |
| normal | `Sea` | v1 | `open.search amazon --tab` (prompts) |
| normal | `spb` | v1 | `open.search gamebanana` (prompts) |
| normal | `Spb` | v1 | `open.search gamebanana --tab` (prompts) |
| normal | `spn` | v1 | `open.search nexusmods` (prompts) |
| normal | `Spn` | v1 | `open.search nexusmods --tab` (prompts) |
| normal | `spp` | v1 | `open.search proton` (prompts) |
| normal | `Spp` | v1 | `open.search proton --tab` (prompts) |
| normal | `sps` | v1 | `open.search steam` (prompts) |
| normal | `Sps` | v1 | `open.search steam --tab` (prompts) |
