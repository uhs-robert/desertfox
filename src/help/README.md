# help

The help page, opened by `help.open`. It reads `commands.json`, the compiled keymap, the stored warnings and the resolved engines.

- `route.ts`: the pages and the hash parser. The sidebar lists Home, Search Engines, Commands and Styling, at `#/`, `#/search-engines`, `#/commands` and `#/styling`. An unknown hash shows Home.
- `model.ts`: turns those three inputs into plain rows. Key args and the `flags` column are written by the registry printer, so the page matches the command line. Tests read the rows, so no DOM is needed.
- Home: the warnings, then the settings in force, read-only like the options page.
- Search Engines page: every resolved engine in tree order with label, URL, needed slots, fallback and the file and level that set each field. `engine.show <name>` opens the page at `#engine=<name>`, which `route.ts` maps to this page, and `main.ts` scrolls to the row.
- `render.ts`: draws the rows with DOM calls. Command text never goes through `innerHTML`.
- `main.ts`: loads the inputs (`commands.json` through `shared/load_commands.ts`) and renders the route in the hash, and renders again on `hashchange`.
- `help.html`: the page and its styles. The defaults use the `--oasisfox-` variables. It loads `content.js` by script tag, because `moz-extension://` pages do not match `<all_urls>`. That gives the page `j`, `k`, `gg` and the mode badge.

`STYLE_VARIABLES` and `STYLE_CLASSES` in `model.ts` list the public styling surface. The variables come from the theme role list, so a new role shows on the Styling page with a meaning the compiler forces you to write. Add a surface's class names there when it ships.
