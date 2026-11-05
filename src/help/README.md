# help

The help page, opened by `help.open`. It reads `commands.json`, the compiled keymap, the stored warnings and the resolved engines.

- `route.ts`: the pages and the hash parser. The sidebar lists Home, Quick Start, Commands, Search Engines and Styling, at `#/`, `#/quick-start`, `#/commands`, `#/search-engines` and `#/styling`. An unknown hash shows Home.
- `quick_start.ts`: the Quick Start text as blocks. A `{name}` in a sentence is looked up in the compiled keymap by command and args, shortest key first. A command with no key shows its command line instead, so a rebind or unbind never leaves the text wrong.
- `model.ts`: turns those three inputs into plain rows. Key args and the `flags` column are written by the registry printer, so the page matches the command line. Tests read the rows, so no DOM is needed.
- Home: the warnings, then the settings in force, read-only like the options page.
- Search Engines page: the guide from `docs/search_engines.md`, then every resolved engine in tree order with label, URL, needed slots, fallback and the file and level that set each field. `engine.show <name>` opens the page at `#engine=<name>`, which `route.ts` maps to this page, and `main.ts` scrolls to the row.
- `blocks.ts`: the block list type. `tools/render_docs.ts` turns the guide's markdown subset into blocks at build time (it fails on any other markdown) and `tools/build.mjs` writes `dist/search_engines_guide.json`. `main.ts` fetches it.
- `render.ts`: draws the rows with DOM calls. Command text never goes through `innerHTML`. A `code_block` gets its own themed box with the fence language as a label and a Copy button. The command usage line keeps the plain `oasisfox-help-usage` look.
- `main.ts`: loads the inputs (`commands.json` through `shared/load_commands.ts`) and renders the route in the hash, and renders again on `hashchange`.
- `help.html`: the page and its styles. The defaults use the `--oasisfox-` variables. It loads `content.js` by script tag, because `moz-extension://` pages do not match `<all_urls>`. That gives the page `j`, `k`, `gg` and the mode badge. `hints.js`, `whichkey.js`, `cmdline.js` and `caret.js` load the same way, for the Quick Start keys (`caret.js` also holds page search). `executeScript` cannot reach extension pages, so each bundle registers itself on load.

`STYLE_VARIABLES` and `STYLE_CLASSES` in `model.ts` list the public styling surface. The variables come from the theme role list, so a new role shows on the Styling page with a meaning the compiler forces you to write. Add a surface's class names there when it ships.
