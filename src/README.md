# src

The code map. Read a folder's README before you change or research code in it.

- [`background/`](background/README.md): the background page. Loads the config, compiles the keymap, routes run requests, answers which-key.
- [`cmdline/`](cmdline/README.md): the command line page and its host bundle.
- [`commands/`](commands/README.md): the command definitions, made with `define` from the registry, plus helpers (`open_target.ts`, `url_build.ts`).
- [`content/`](content/README.md): the content script. Captures keys, tracks the mode and loads the bundles.
  - [`content/caret/`](content/caret/README.md): caret and visual mode.
  - [`content/hints/`](content/hints/README.md): link hints.
  - [`content/whichkey/`](content/whichkey/README.md): the which-key panel.
  - [`content/handlers/`](content/handlers/README.md): the content-side handler for each command group.
  - [`content/ui/`](content/ui/README.md): the `ui` bundle, the mode badge and the toast.
- [`help/`](help/README.md): the help page.
- `icons/`: the extension icon.
- [`options/`](options/README.md): the options page.
- [`shared/`](shared/README.md): types and constants shared by all folders.
  - [`shared/keys/`](shared/keys/README.md): key notation, the prefix tree compiler and the matcher.
  - [`shared/registry/`](shared/registry/README.md): the command registry, its args check and the command line parser.

`manifest.json` and `managed_schema.json` sit at this level.
