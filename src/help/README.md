# help

The help page, opened by `help.open`. It reads `commands.json`, the compiled keymap and the stored warnings.

- `model.ts`: turns those three inputs into plain rows. Tests read the rows, so no DOM is needed.
- `render.ts`: draws the rows with DOM calls. Command text never goes through `innerHTML`.
- `main.ts`: loads the inputs (`commands.json` through `shared/load_commands.ts`) and calls the renderer.
- `help.html`: the page and its styles. The defaults use the `--oasisfox-` variables. It loads `content.js` by script tag, because `moz-extension://` pages do not match `<all_urls>`. That gives the page `j`, `k`, `gg` and the mode badge.

`STYLE_VARIABLES` and `STYLE_CLASSES` in `model.ts` list the public styling surface. Add a surface's class names there when it ships.
