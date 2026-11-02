# options

The read-only status page. It opens in a tab from the add-on preferences or `runtime.openOptionsPage()`. It shows the config source, every setting in force, the stored warnings and the rebuild steps. It has no inputs and writes nothing.

- `model.ts`: turns the stored config status and warnings into plain rows. Tests read the rows, so no DOM is needed. Settings rows come from the stored object, so a new setting shows without a change here.
- `render.ts`: draws the rows with DOM calls. Text never goes through `innerHTML`.
- `main.ts`: reads `oasisfox_config_status` and `oasisfox_warnings` from `storage.local`. The background writes both at startup.
- `options.html`: the page and its styles, copied from the help page.

This page does not load `content.js`. The help page does.
