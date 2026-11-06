# 🦊 DesertFox

<p align="center"><img src="./src/icons/desertfox.svg" height="128" alt="DesertFox logo"/></p>

<hr/>

<p align="center">
  <a href="https://github.com/uhs-robert/desertfox/stargazers"><img src="https://img.shields.io/github/stars/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=e0b97a" alt="Stars"/></a>
  <a href="https://github.com/uhs-robert/desertfox/issues"><img src="https://img.shields.io/github/issues/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=c8664a" alt="Issues"/></a>
  <a href="https://github.com/uhs-robert/desertfox/graphs/contributors"><img src="https://img.shields.io/github/contributors/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=d9822b" alt="Contributors"/></a>
  <a href="https://github.com/uhs-robert/desertfox/forks"><img src="https://img.shields.io/github/forks/uhs-robert/desertfox?style=for-the-badge&logo=github&colorA=3b2416&colorB=8a6a9e" alt="Forks"/></a>
</p>

<p align="center"><sub>Desert the mouse, navigate the web with only your keyboard</sub></p>

## 🦊 What it is

DesertFox is a modern, keyboard-driven Firefox extension built for speed, discoverability, and complete control of the web browser. Browse the web without the mouse.

> [!WARNING]
> DesertFox is under construction.
> It has no release yet, so there is nothing to install today.

Inspired by the Vim text editor, DesertFox uses mnemonic keys, chorded key sequences, and modal systems for full browser navigation and control from the keyboard alone. We also take inspiration from other keyboard-driven browser extensions (Tridactyl and Vimium) and web browsers (qutebrowser). We're not a clone of these other solutions. We build upon their ideas while also taking our own approach to usability, discoverability, customization, and command registration.

Our goal is to provide a powerful keyboard-driven workflow that is easy to learn as you go without having to memorize a bunch of commands. We accomplish this with key popups that appear when you press any key, intelligent command completion when typing commands, and built-in help so you can discover features naturally as you use them.

The keys follow Vim habits: modes, `hjkl` to scroll, `gg` and `G` to jump, `yy` to copy, `/` to search, and counts for repeated actions. You do not need to know Vim, simply type `g?` to see every key or `:` to see/type any command manually.

## ✨ Features

- Click anything: press `f`, then type the short label next to a link, button, input or image.
- Open a link in a background tab without touching the mouse: press `F`.
- Copy a link or the text of any element: `;yl` copies the link and `;Yp` copies the text.
- Run commands by name: `:` opens a line that completes commands, tabs, bookmarks, history and search engines as you type.
- Manage tabs: switch, move, pin, mute, close and reopen them, or open one in a container from `t`.
- Search the page: `/` finds text, including with regular expressions.
- Search the web: bind a key to any search engine you use.
- Select and copy text without the mouse: `v` and `V` move and select by keyboard.
- Learn as you go: pause after pressing nearly any key and a popup lists what can follow.
- Get help: a help page lists every key, and a Quick Start page teaches the first ones.
- Make it yours: pick a color theme, and use the new tab page for a clock, links, recent tabs and bookmarks.

## 🔍 How it compares

DesertFox is for Firefox users who want a powerful keyboard browsing experience without memorizing a manual first. It needs no hours of customization, no new web browser and no loss of your Firefox add-ons.

This is how we compare to the rest of the competition. These facts come from each project's source and, for add-ons, its Mozilla download in November 2026.

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

In short, we mix the power of Tridactyl with the simplicity of Vimium. Our key popup and autocompletion systems teach you how to use it while you're behind the wheel so you don't need to read the manual while you're driving.

> [!NOTE]
> The table shows size, not page speed. The sizes are as shipped.
> DesertFox is minified and the other two are not, and we defer loading hint and caret code to first use.

## 📦 Install

When DesertFox is released, you will install it from a Firefox add-on file that Mozilla has signed. Firefox asks you to confirm the permissions, then adds the add-on. No public listing exists.

Until then, only contributors can run it. See [AGENTS.md](AGENTS.md) for the build and install commands.

## 🚀 Try it

After you install DesertFox, press `g?`, `qh` or `<F1>` on a normal page. The help page opens. Start with the Quick Start page, which teaches the first keys. A short pause after a key shows the keys that can follow.

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
