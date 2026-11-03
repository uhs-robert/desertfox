# OasisFox

A keyboard-first Firefox extension with one command registry. Keys, the command line, completion, help and which-key all read the same command definitions. It works on its own, and integrates with Oasis Dots (Hyprland and Quickshell) through an optional native host.

Status: phase 1 is built. Release 0.1.1 adds the toolbar button, the status page and the keys below.

## What 0.1.1 adds

- A toolbar button titled "OasisFox". The `mode_indicator` setting (`always`, `not_normal`, `off`) controls the page badge. The `palette` setting picks the badge colors from the 16 oasis.nvim palettes (default `moonlight`, light or dark follows the system theme).
- A read-only status page in the add-on options. It shows the config source, the settings in force, the keymap warnings and the rebuild steps.
- The help page takes keys, so `j`, `k` and `gg` scroll it.
- `zt`, `zz` and `zb` scroll the focused field to the top, center or bottom of the view. After `gi` and `Escape` they align the field you just left. Zoom reset moved from `zz` to `z=`.
- `page.blur` moved from `zb` to `qb`. The `q` group holds OasisFox's own commands: `qr` reload config, `qh` help, `qi` ignore mode, `qb` blur.
- The plain keys `r`, `t` and `x` are now prefixes: `rr` reload, `rh` hard reload, `ri` site check, `tt` open in a new tab, `tT tm td tn tp ta tf tl` for tabs, `xx` close tab, `xp` stop loading.
- The defaults bind every `v1` row of the binding map whose command exists, except the search engine and container keys, which come from your config. See [docs/keymap.md](docs/keymap.md).

## Config

Write your keys in TOML in `~/.config/oasisfox/`, then run `just build-config`. The tool checks the files and writes the merged config that Firefox reads from managed storage. A binding is one line of command text, the same words you type in the command line:

```toml
# ~/.config/oasisfox/keymap.toml
[normal]
J = "tab.next"                  # a command name or id
o = "open"                      # asks for the URL
O = "open tab"                  # a bare word sets the param it names
sa = "search arch"              # the first bare word picks the engine
gt = "tab.goto 1"               # a bare number sets a command's only number param
gO = ":open tab @current_url"   # a leading ":" types it into the command line and waits
y = ""                          # "" removes a default binding
```

`@current_url`, `@selection` and `@clipboard` are filled in when you press the key. The first free word starts the main value (the URL, the query) and the rest of the line joins into it, so `search arch pacman mirrors` searches for "pacman mirrors". A query that starts with an engine name needs `query="..."`. Quote other text that has spaces or `=`. Any param can be written `name=value`. Files `search_engines.toml`, `command_aliases.toml` and `settings.toml` sit beside the keymap, and each can have a `.d/` directory of later files. See [docs/design.md](docs/design.md#config) for the full format. Copy [`examples/engines.toml`](examples/engines.toml) to start your engines file, or see [a fuller real example](https://github.com/uhs-robert/oasis-dots/blob/main/home/oasisfox/.config/oasisfox/search_engines.toml).

- [docs/design.md](docs/design.md): architecture, scope and roadmap.
- [docs/spike.md](docs/spike.md): what Firefox allows, measured.
- [docs/keymap.md](docs/keymap.md): every current browser binding and what replaces it.
- `spike/`: the throwaway test harness from phase 0.

## Known limits

Plain keys such as `J` and `K` do nothing until the tab's page starts loading, so a press on an unloaded tab is lost. `Alt+j` and `Alt+k` use Firefox shortcuts and switch tabs at once. Plain keys never work on pages where Firefox blocks extensions: `about:` pages, the PDF viewer, reader view and addons.mozilla.org.

License: [MPL 2.0](LICENSE).
