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

DesertFox is a keyboard-driven Firefox extension built for speed, discoverability and complete control of the browser. It mixes the power of Tridactyl with the simplicity of Vimium. A which-key popup teaches every key as you press it.

You learn it as you go, with no manual to memorize. Press any key and the popup lists every key that can follow and what it does. Type `:` and commands complete as you type. Press `g?` to open the help page, which lists every key. Type `:help.whichkey` to show the top-level keys of the current mode in the popup.

The keys follow Vim habits: modes, `hjkl` to scroll, `gg` and `G` to jump, `yy` to copy, `/` to search, counts, registers and macros. You do not need to know Vim.

## 🏆 Why DesertFox

- **You learn it as you go.** Pause after a key and a popup lists the keys that can follow, with what each does. The popup shows live data too: your marks under `'`, your registers under `"` and your macros under `@`. The command line lists every command and completes its flags and values.
- **It checks what you give it.** Every command is defined once, with typed arguments. A key, a typed command and a config line all pass the same check, so a typo is an error with a message and never a silent no-op. A config file error names the file, line and column.
- **It stays light on every page.** The script DesertFox loads into each page is 18.5 KB, and the build fails if it grows past that. Hints, caret mode and the command line load on first use.
- **It is always ready.** DesertFox runs on a background page that stays loaded, and keeps its state in storage. A page gets its keys within milliseconds of starting to load.
- **It grows with you.** The first day needs five keys: `j`, `k`, `f`, `:` and `g?`. Macros, registers, marks, per-site rules and your own commands wait until you want them, and the popup teaches each one when you reach it. See [Features](#-features).
- **It is safe by design.** DesertFox never evaluates text as code. The optional helper program outside Firefox takes a fixed set of requests and cannot run a shell command.
- **It is tested with real key presses.** A test suite presses real keys in a real Firefox, on top of the unit tests.

## 🔍 How it compares

Power without a manual to memorize, a new browser to learn, or your Firefox add-ons to give up.

| Feature | DesertFox | Vimium | Vimium C | Tridactyl | qutebrowser (a whole browser, not an extension) |
| --- | --- | --- | --- | --- | --- |
| Hints with modifiers | ✅ | 🟡 | ✅ | ✅ | ✅ |
| Hint filters | ✅ | 🟡 | ✅ | ✅ | ✅ |
| Key popup (which-key) | ✅ | ❌ | ❌ | ❌ | ✅ |
| Generated help | ✅ | 🟡 | 🟡 | ✅ | ✅ |
| Command line with completion | ✅ | 🟡 | 🟡 | ✅ | ✅ |
| Caret mode | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Visual mode | ✅ | ✅ | ✅ | 🟡 | ✅ |
| Page search | ✅ | ✅ | ✅ | 🟡 uses the Firefox find bar | ✅ |
| Macros | ✅ | ❌ | ❌ | ❌ | ✅ |
| Per-site keys and settings | ✅ | keys only | 🟡 | ✅ | ✅ |
| Containers | ✅ | ❌ | 🟡 | ✅ | ❌ |
| Config file | ✅ | ❌ | ❌ | ✅ | ✅ |
| Helper program outside the browser | optional, fixed requests | none | none | optional, runs shell commands | n/a |
| Works with other Firefox add-ons | ✅ | ✅ | ✅ | ✅ | ❌ |
| Script loaded on every page | 18.5 KB | 254 KB | 94 KB | 1.1 MB | n/a |

✅ yes · ❌ no · 🟡 partial

Sources, read in November 2026: each project's documentation, source code and shipped add-on.

- Vimium: [README](https://github.com/philc/vimium/blob/master/README.md).
- Vimium C: [README](https://github.com/gdh1995/vimium-c/blob/master/README.md) and the 2.12.3 add-on.
- Tridactyl: [command source](https://github.com/tridactyl/tridactyl/blob/master/src/excmds.ts) (`bindurl`, `seturl`, `exclaim`).
- qutebrowser: [command reference](https://github.com/qutebrowser/qutebrowser/blob/main/doc/help/commands.asciidoc).

> [!NOTE]
> The last row shows size, not page speed. The sizes are as shipped.
> DesertFox and Vimium C are minified, and Vimium and Tridactyl are not. DesertFox defers loading hint and caret code to first use.

### Where another tool fits better

- You use Chrome, Edge or Safari. DesertFox runs on desktop Firefox only. Vimium and Vimium C cover the other browsers.
- You want keys on every page, with no exception. Only a browser built for the keyboard, such as qutebrowser, gives that. An extension cannot run on Firefox's own pages.
- You want to run shell commands or your own scripting language from the browser. Tridactyl allows both. DesertFox leaves them out on purpose.
- You want the smallest set of keys and nothing to configure. Vimium has the fewest commands, but you learn them from its help page. DesertFox shows the next keys in its which-key popup after a short pause.

## ✨ Features

- Click anything with `f`, and scroll, search and select text without the mouse.
- Run any command by name with `:`, with completion for every flag and value.
- Manage tabs, bookmarks, history, containers and tab sessions.
- Repeat yourself with `.`, macros, registers and marks.
- Control video and audio from the keyboard.
- Set keys and settings per site, and keep your config in files.

Open a group for the details. [docs/keymap.md](docs/keymap.md) lists every default key.

<details>
<summary><b>🖱️ Move and click</b></summary>

- Click anything: press `f`, then type the short label next to a link, button, input or image. `F` opens a link in a background tab.
- Narrow the labels by link text: press `/` in hint mode and type part of the text.
- Do more with a label: the `;` keys copy a link, a picture, an element's text, its CSS selector or its HTML, download a file, hover, or focus a frame.
- Scroll with `j` and `k`, jump with `gg` and `G`, and go back and forward with `H` and `L`.
- Jump between headings with `sh`, and to the next or previous page with `]]` and `[[`.

</details>

<details>
<summary><b>🔍 Find, select and copy</b></summary>

- Search the page: `/` finds text as you type, with regular expressions, and `n` and `N` move between matches.
- Select text without the mouse: `v` puts a caret in the page and `V` starts a selection, both with Vim motions.
- Copy the page address with `yy`, or every link on the page with `yL`. Tracking parameters are dropped from copied addresses.
- Keep text in registers: `"ay` copies into register `a`, and `"app` opens it.

</details>

<details>
<summary><b>🗂️ Tabs and windows</b></summary>

- Switch, move, pin, mute, close and reopen tabs. `T` lists your tabs and filters as you type.
- Find anything: `,,` searches open tabs, bookmarks, history, quickmarks and closed tabs in one list.
- Save and reopen sets of tabs: `ts` saves the window as a named session and `tS` opens one.
- Free memory: unload tabs you are not using and load them again later.
- Reopen a page in a Firefox container, with keys you bind to your own containers.

</details>

<details>
<summary><b>⌨️ Commands and search</b></summary>

- Run commands by name: `:` opens a line that completes commands, flags, tabs, bookmarks, history and search engines.
- Open a page or search with `o`, or in a new tab with `O`.
- Search the web: bind a key to any search engine. An engine can read the page you are on, for example to search inside the current GitHub repository.
- Open Firefox's own pages, such as settings, add-ons and downloads, with the `,f` keys. They need the native host. Without it, DesertFox copies the address for you to paste.
- Open bookmarks, add them and file them in folders from the keyboard.

</details>

<details>
<summary><b>🔁 Repeat and remember</b></summary>

- Repeat the last command or typed text with `.`.
- Record a macro with `q` and a letter, and replay it with `@`.
- Mark a place on a page with `m` and return with `'`. A capital letter marks a page you can jump to from any tab.
- Save a page under one key with `M`, and open it with `go` or `gn`.

</details>

<details>
<summary><b>🎬 Media</b></summary>

- Play, pause, seek, change speed and volume, toggle captions, fullscreen and picture-in-picture from the keyboard.
- Press `aa` for a media mode with one-key controls. It starts by itself when a video goes fullscreen.
- Pick the video quality on sites whose player DesertFox knows. The `media_quality` setting sets a level for every site or for chosen sites, and it applies when a video loads.

</details>

<details>
<summary><b>🎨 Make it yours</b></summary>

- Per-site rules: turn DesertFox off on a site, give some keys back to the page, bind keys for one site, or set zoom and other settings per site.
- Change settings in the browser with `:set` or on the settings page.
- Keep your keys, search engines and settings in TOML files. DesertFox checks them and applies an edit with one key, with no restart.
- Add your own commands as snippets of page code.
- Pick one of the built-in color themes, write your own, or restyle every surface with CSS.
- Use the new tab page for a clock, links, recent tabs and bookmarks.

</details>

## 📦 Install

> [!WARNING]
> DesertFox is under construction.
> It has no stable release and no listing on addons.mozilla.org yet. A signed beta is available.

### Beta

A beta build is signed by Mozilla, built nightly from `main` and updates itself. Open the [latest beta](https://github.com/uhs-robert/desertfox/releases?q=prerelease%3Atrue) release and open its `desertfox-<version>.xpi` in Firefox. Firefox asks you to confirm the permissions, then adds the add-on. You can also run `tools/install_policy.sh beta` to pin it through the policy file. See [Release channels](docs/design.md#release-channels).

### Native host (optional)

The native host is a small helper program on your computer. Firefox does not let extensions read files or start programs, so DesertFox uses the host for the features that need them. Linux only.

With it you can:

- Edit text in your own editor: press `<C-o>` in insert mode to edit a text field in an editor such as Neovim. You name the editor in an `editor.toml` file.
- Open Firefox pages: the `,f` keys open settings, add-ons and downloads.
- Keep your setup in files: store keys, search engines and settings in TOML files in `~/.config/desertfox/`, or in `$XDG_CONFIG_HOME/desertfox/` when that variable holds an absolute path.
- Update from the command line: `:native.update` updates the host and checks the download against hashes in the signed extension.
- Use scripts: the bridge (a second helper, off by default) lets scripts run DesertFox commands, read the current mode and follow your desktop theme.

Without the host, almost everything works. Change settings with `:set` or on the settings page, and bring in keys, search engines and themes there as a zip or a folder. Only the features above need the host. The `,f` keys copy the page address instead, so you can paste it.

To install it, run `:native.install` in DesertFox. It shows one command to paste in a terminal. On that page, also grant the `nativeMessaging` permission with its button, because the host features need it. See [host/README.md](host/README.md) for how the host works, the bridge setup and every detail.

What the host can and cannot do:

- It has a fixed list of actions: read the config files, write one file for your saved edits, update itself, edit text, open a Firefox page and, with the bridge, pass commands to DesertFox. It has no shell and no way to run a command that someone sends it.
- A web page cannot give it an address. The `,f` keys pick a page from a fixed table, not a URL.
- Text from a web page goes only into a temporary file for your editor. The editor program comes from your own `editor.toml`.
- The updater starts at this project's GitHub releases and follows up to five HTTPS redirects, without limiting which hosts they lead to. It refuses a redirect that is not HTTPS, and refuses a file that does not match the hashes in the signed extension.
- With the bridge on, DesertFox itself decides which commands a script can run, and private tabs and their ids stay hidden. A focused private window still shows `private: true` and its mode.

### From source

See [AGENTS.md](AGENTS.md) for the build and install commands.

## 🚀 Try it

After you install DesertFox, press `g?`, `,h` or `<F1>` on a normal page. The help page opens. A short pause after a key shows the keys that can follow. On a page where keys never reach DesertFox, such as an `about:` page or the PDF viewer, type `df`, a space and a command in the address bar, for example `df tab.next`.

The Quick Start page opens on first install and sits in the help sidebar. It teaches scrolling, hints, the command line, page search, caret and visual mode, with the keys read from your keymap.

## 🏜️ Known limits

- Plain keys never work on pages where Firefox blocks extensions: `about:` pages, the PDF viewer, reader view and addons.mozilla.org. The `df` keyword in the address bar and the `Alt` chords still work there.
- For keys in PDF files, let an external viewer open them: in Firefox Settings, under Applications, set Portable Document Format to "Use system default".
- A plain key such as `J` is lost when it lands on a tab that has not started loading. `Alt+j` and `Alt+k` switch tabs at once, but not on pages that cancel keys. Details are in [docs/firefox-behavior.md](docs/firefox-behavior.md).

## 🧭 Docs

- [docs/design.md](docs/design.md): architecture, scope and roadmap.
- [docs/keymap.md](docs/keymap.md): every default key, and the keys that are planned or dropped.
- [docs/firefox-behavior.md](docs/firefox-behavior.md): what Firefox allows, measured.
- [src/README.md](src/README.md): a code map for contributors.

## License

[MPL 2.0](LICENSE).
