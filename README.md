# 🦊 DesertFox

<p align="center"><img src="./src/icons/desertfox.svg" height="128" alt="DesertFox logo"/></p>

<hr/>

<p align="center">
  <a href="https://github.com/uhs-robert/desertfox/stargazers"><img src="https://img.shields.io/github/stars/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=e0b97a" alt="Stars"/></a>
  <a href="https://github.com/uhs-robert/desertfox/issues"><img src="https://img.shields.io/github/issues/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=c8664a" alt="Issues"/></a>
  <a href="https://github.com/uhs-robert/desertfox/graphs/contributors"><img src="https://img.shields.io/github/contributors/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=d9822b" alt="Contributors"/></a>
  <a href="https://github.com/uhs-robert/desertfox/forks"><img src="https://img.shields.io/github/forks/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=8a6a9e" alt="Forks"/></a>
</p>

## 🦊 What it is

DesertFox is a keyboard-first Firefox add-on. Every command is defined once in a registry. Keys, the command line, completion, help and which-key (the hint popup that lists the keys after a prefix) all read that one definition. It works on its own.

Status: under construction. DesertFox has no release yet, so there is nothing to install today.

## ✨ Features

- Hints: press `f` to label every clickable element, then type a label to click it. `F` opens it in a background tab.
- Hint filters: other keys under `;` pick links, inputs, images, media, scroll boxes or frames. Hints reach into shadow roots (isolated parts of a page).
- Command line: `:` opens a line with fuzzy completion for commands, flags, tabs, bookmarks, history, search engines, containers and headings.
- Tabs: keys and commands to switch, move, pin, mute, unload, close and reopen tabs, and to open them in a container.
- Page search: `/` finds text with regular expressions and smartcase, across shadow roots and same-origin frames.
- Search engines: bind a key to any engine, with groups for site search.
- Caret and visual mode: `v` and `V` move and select text from the keyboard, with counts and character find.
- Which-key: after a prefix, a popup lists the keys that can follow, with their labels.
- Help and Quick Start: a help page built from the live keymap, with a guided Quick Start.
- Themes and new tab page: colors for every DesertFox surface, a clock, links, recent tabs and bookmarks on the new tab page.

## 📦 Install

When DesertFox is released, you will install it from a Firefox add-on file that Mozilla has signed. Firefox asks you to confirm the permissions, then adds the add-on. No public listing exists.

Until then, only contributors can run it. See [AGENTS.md](AGENTS.md) for the build and install commands.

## 🚀 Try it

After you install DesertFox, press `g?`, `qh` or `<F1>` on a normal page. The help page opens. Start with the Quick Start page, which teaches the first keys. A short pause after a prefix key shows which-key.

## ⚙️ Config

You write the config in TOML in `~/.config/desertfox/`, then run `just build-config`. The tool checks the files and writes the merged config that Firefox reads. A binding is one line of the same command text that you type in the command line.

```toml
# ~/.config/desertfox/keymap.toml
[normal]
H = "tab.prev"                  # H goes to the previous tab, not back in history
L = "tab.next"                  # L goes to the next tab, not forward in history
zi = "zoom.by 0.25"             # a bare number sets the zoom step (default 0.1)
y = ""                          # "" removes a default binding
```

Files beside the keymap set search engines, command aliases, settings, styles and themes. Each can have a `.d/` directory of later files. The full format is in [docs/design.md](docs/design.md#config).

## 🏜️ Known limits

- Plain keys never work on pages where Firefox blocks extensions: `about:` pages, the PDF viewer, reader view and addons.mozilla.org.
- A plain key such as `J` is lost when it lands on a tab that has not started loading. `Alt+j` and `Alt+k` switch tabs at once, but not on pages that cancel keys. Details are in [docs/firefox-behavior.md](docs/firefox-behavior.md).
- Planned and not built: a native host (a helper program outside Firefox) for optional desktop integration.

## 🧭 Docs

- [docs/design.md](docs/design.md): architecture, config format, scope and roadmap.
- [docs/keymap.md](docs/keymap.md): every default key, and the keys that are planned or dropped.
- [docs/search_engines.md](docs/search_engines.md): the search engine config.
- [docs/firefox-behavior.md](docs/firefox-behavior.md): what Firefox allows, measured.
- [src/README.md](src/README.md): a code map for contributors.

## License

[MPL 2.0](LICENSE).
