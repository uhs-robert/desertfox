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

DesertFox lets you browse the web without the mouse. Click any link, button or image with a few keystrokes. Switch tabs, search the page and copy links from the keyboard. Press `g?` to see every key.

Status: under construction. DesertFox has no release yet, so there is nothing to install today.

## ✨ Features

- Click anything: press `f`, then type the short label next to a link, button, input or image.
- Open a link in a background tab without touching the mouse: press `F`.
- Run commands by name: `:` opens a line that completes commands, tabs, bookmarks, history and search engines as you type.
- Manage tabs: switch, move, pin, mute, close and reopen them, or open one in a container.
- Search the page: `/` finds text, including with regular expressions.
- Search the web: bind a key to any search engine you use.
- Select and copy text without the mouse: `v` and `V` move and select by keyboard.
- Learn as you go: pause after a key and a popup lists what can follow.
- Get help: a help page lists every key, and a Quick Start page teaches the first ones.
- Make it yours: pick a color theme, and use the new tab page for a clock, links, recent tabs and bookmarks.

## 📦 Install

When DesertFox is released, you will install it from a Firefox add-on file that Mozilla has signed. Firefox asks you to confirm the permissions, then adds the add-on. No public listing exists.

Until then, only contributors can run it. See [AGENTS.md](AGENTS.md) for the build and install commands.

## 🚀 Try it

After you install DesertFox, press `g?`, `qh` or `<F1>` on a normal page. The help page opens. Start with the Quick Start page, which teaches the first keys. A short pause after a key shows the keys that can follow.

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
