# src

The code map. Read a folder's README before you change or research code in it.

- [`background/`](background/README.md): the background page. Loads the config, compiles the keymap, routes run requests, answers which-key.
- [`cmdline/`](cmdline/README.md): the command line page, its completion list and its host bundle.
- [`commands/`](commands/README.md): the command definitions, made with `define` from the registry, plus helpers (`open_target.ts`, `url_build.ts`).
- [`content/`](content/README.md): the content script. Captures keys, tracks the mode and loads the bundles.
  - [`content/caret/`](content/caret/README.md): caret and visual mode.
  - [`content/grab/`](content/grab/README.md): keyboard drag, `;g` and `;G`.
  - [`content/hints/`](content/hints/README.md): link hints and the page headings list.
  - [`content/whichkey/`](content/whichkey/README.md): the which-key panel.
  - [`content/handlers/`](content/handlers/README.md): the content-side handler for each command group.
  - [`content/ui/`](content/ui/README.md): the `ui` bundle, the mode badge and the toast.
  - [`content/page/`](content/page/README.md): the `page` bundle: `scroll.align`, `copy.url`, and `page.focus_input`. [`content/editor/`](content/editor/README.md): the `editor` bundle: `text.edit_external`. [`content/site_actions/`](content/site_actions/README.md): the `site_actions` bundle: `page.send_key` and `page.clipboard`.
  - [`content/media/`](content/media/README.md): the `media` bundle, which the background injects into every frame for the `media` command.
  - [`content/quality/`](content/quality/README.md): the `quality` bundle, which the background injects into every frame for `media quality` and `media skip` and for the `media_quality` rule.
  - [`content/text/`](content/text/README.md): the `text` bundle: the typed-text recorder for `.`, the shared field writer and `is_secret_field`.
- [`devtools/`](devtools/README.md): the devtools page, which selects a hint pick in the Inspector.
- [`help/`](help/README.md): the help page.
- [`newtab/`](newtab/README.md): the new tab page.
- [`popup/`](popup/README.md): the toolbar popup.
- `icons/`: the extension icon. The build writes the grey off copy (`tools/grey_svg.mjs`).
- [`shared/`](shared/README.md): types and constants shared by all folders.
  - [`shared/keys/`](shared/keys/README.md): key notation, the prefix tree compiler and the matcher.
  - [`shared/config_build/`](shared/config_build/README.md): the pure config build from raw file text.
  - [`shared/registry/`](shared/registry/README.md): the command registry, its args check and the command line parser.

`manifest.json` sits at this level.
