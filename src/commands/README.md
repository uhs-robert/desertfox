# commands

The command definitions. Each file is a command module: it calls `define` from `src/shared/registry/` once per command and holds the code that runs it. Keys, the command line, completion, help and which-key read the definition and never carry behavior of their own.

- A definition gives an id (`tab.pin`, group then verb), a label, an intent, params and `runs_in`. The first sentence of the intent is the summary that lists show: a verb first, at most 60 characters, no other command named. Every flag param has a one-sentence `description`. A registry audit test checks both. A `background` command runs here, with browser APIs. A `content` command's `run` is a handler from `src/content/handlers/`, which the content script runs in the page (`scroll.ts`, `copy.ts`, `mode.ts`).
- Set the typed `name` by hand, and only for one-word commands and family words (`open`, `search`, `tab`). Every other command is typed by its dotted id. The registry rejects a duplicate name.
- Modules by group: `tab`, `window`, `bookmark`, `browser`, `zoom`, `page`, `url`, `scroll`, `mode`, `copy`, `config` and `help`. `open.ts` holds `open.url`, `open.search` and `open.clipboard`. `engine.ts` holds `engine.show`.
- `hint.ts`, `cmdline.ts`, `caret.ts` and `visual.ts` hold commands whose code sits in a bundle. Running one loads the bundle, or refuses with a `NEEDS_*` message until the bundle registers a handler (`src/content/handlers/lazy_bundle.ts`).

Helpers:

- `open_target.ts`: the `where` and `container` params, `open_in` (opens a URL here, in a tab or in a window), the container lookup, `current_tab_url` and `current_page` (the page that engine slots read), and `typed_url_target` for text a person typed.
- `url_build.ts`: pure URL math. `parent_url` and `root_url`, `url_target` (text to a URL), and the two engine fillers: `engine_search_url` for typed text and `engine_url`, which follows `fallback` when the page cannot fill the slots. The slot table and the template filler are in `src/shared/engines/`.

To add a command: pick the module of its group, or add one. Call `define` with the id, label, intent and params. Import the module in `src/background/command_modules.ts` and add it to `COMMAND_MODULES` in `tools/write_commands_json.mjs`. Put browser access in `run` and keep URL math in a pure function with a test. A command that only opens a URL is better as an engine in the user's config, and one that needs the page DOM or several steps as a snippet.
