# 🦊 DesertFox

<p align="center"><img src="./src/icons/desertfox.svg" height="128" alt="DesertFox logo"/></p>

<hr/>

<p align="center">
  <a href="https://github.com/uhs-robert/desertfox/stargazers"><img src="https://img.shields.io/github/stars/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=e0b97a" alt="Stars"/></a>
  <a href="https://github.com/uhs-robert/desertfox/issues"><img src="https://img.shields.io/github/issues/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=c8664a" alt="Issues"/></a>
  <a href="https://github.com/uhs-robert/desertfox/graphs/contributors"><img src="https://img.shields.io/github/contributors/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=d9822b" alt="Contributors"/></a>
  <a href="https://github.com/uhs-robert/desertfox/forks"><img src="https://img.shields.io/github/forks/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=8a6a9e" alt="Forks"/></a>
</p>

<p align="center"><i>Desert the mouse, navigate the web with only your keyboard</i></p>

## 🦊 What it is

DesertFox is a modern, keyboard-driven Firefox extension built for speed, discoverability, and complete control of the web browser. It mixes the power of Tridactyl with the simplicity of Vimium. A which-key popup teaches every key as you press it.

You learn it as you go, with no manual to memorize. Press any key and the popup lists every key that can follow and what it does. Type `:` and commands complete as you type. Press `g?` to see every key.

The keys follow Vim habits: modes, `hjkl` to scroll, `gg` and `G` to jump, `yy` to copy, `/` to search, and counts. You do not need to know Vim.

## ✨ Features

- Click anything: press `f`, then type the short label next to a link, button, input or image.
- Narrow the labels by link text: press `/` in hint mode and type part of the text. A line at the bottom right shows these keys, and `hint_key_line` hides it.
- Open a link in a background tab without touching the mouse: press `F`.
- Copy from the page with the `;y` yank keys: `;yl` copies a link, `;yt` the text of any element, `;yc` its shortest CSS selector and `;yh` its outer HTML.
- Run commands by name: `:` opens a line that completes commands, tabs, bookmarks, history and search engines as you type.
- Manage tabs: switch, move, pin, mute, close and reopen them, or reopen one in a container with the `c` keys.
- Search the page: `/` finds text, including with regular expressions.
- Search the web: bind a key to any search engine you use.
- Select and copy text without the mouse: `v` and `V` move and select by keyboard.
- Learn as you go: pause after pressing nearly any key and a popup lists what can follow.
- Get help: a help page lists every key, and a Quick Start page teaches the first ones.
- Make it yours: pick a color theme, and use the new tab page for a clock, links, recent tabs and bookmarks.

## 🔍 How it compares

Power without a manual to memorize, a new browser to learn, or your Firefox add-ons to give up.

Sources: each project's code and shipped add-on, November 2026.

| Feature | DesertFox | Vimium | Tridactyl | qutebrowser |
| --- | --- | --- | --- | --- |
| Hints with modifiers | yes | partial | yes | yes |
| Hint filters | yes | partial | yes | yes |
| Key popup (which-key) | yes | no | no | yes |
| Generated help | yes | partial | yes | yes |
| Command line with completion | yes | partial | yes | yes |
| Caret mode | yes | partial | no | yes |
| Visual mode | yes | yes | partial | yes |
| Page search | yes | yes | yes | yes |
| Containers | yes | no | yes | no |
| Config file | yes | no | yes | yes |
| Works with other Firefox add-ons | yes | yes | yes | no |
| Script loaded on every page | 15 KB | 254 KB | 1.1 MB | n/a |

> [!NOTE]
> The table shows size, not page speed. The sizes are as shipped.
> DesertFox is minified and the other two are not, and we defer loading hint and caret code to first use.

## 📦 Install

> [!WARNING]
> DesertFox is under construction.
> It has no release yet, so there is nothing to install today.

When DesertFox is released, you will install it from a Firefox add-on file that Mozilla has signed. Firefox asks you to confirm the permissions, then adds the add-on. No public listing exists.

Until then, only contributors can run it. See [AGENTS.md](AGENTS.md) for the build and install commands.

### Beta

A beta build is signed by Mozilla, built nightly from `main` and updates itself. Open the [latest beta](https://github.com/uhs-robert/desertfox/releases?q=prerelease%3Atrue) release and open its `desertfox-<version>.xpi` in Firefox, or run `tools/install_policy.sh beta` to pin it through the policy file. Stable builds do not receive beta updates. See [Release channels](docs/design.md#release-channels).

## 🚀 Try it

After you install DesertFox, press `g?`, `,h` or `<F1>` on a normal page. The help page opens. A short pause after a key shows the keys that can follow.

The Quick Start page opens on first install and sits in the help sidebar. It teaches scrolling, hints, the command line, page search, caret and visual mode, with the keys read from your keymap.

## 🏜️ Known limits

- Plain keys never work on pages where Firefox blocks extensions: `about:` pages, the PDF viewer, reader view and addons.mozilla.org.
- A plain key such as `J` is lost when it lands on a tab that has not started loading. `Alt+j` and `Alt+k` switch tabs at once, but not on pages that cancel keys. Details are in [docs/firefox-behavior.md](docs/firefox-behavior.md).
- Planned and not built: a native host (a helper program outside Firefox) for optional desktop integration.

## 🧭 Docs

- [docs/design.md](docs/design.md): architecture, scope and roadmap.
- [docs/keymap.md](docs/keymap.md): every default key, and the keys that are planned or dropped.
- [docs/firefox-behavior.md](docs/firefox-behavior.md): what Firefox allows, measured.
- [src/README.md](src/README.md): a code map for contributors.

## License

[MPL 2.0](LICENSE).
