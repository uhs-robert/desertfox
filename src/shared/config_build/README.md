# config_build

Builds the merged config from the user's config files. It takes raw file text and the command list, and uses no Node API. The extension and `tools/build-config` both run it. The tool reads the files from disk. `tools/build-config/README.md` lists what stays there.

- `build_config.ts`: `build_config(files, commands, warnings, options)`, the whole pipeline. `commands_of_registry` cuts the command list from the live registry, where the tool reads `dist/commands.json`. The `dir_label` option prefixes every path in a problem message and in the config's `origins`, so a tool run keeps absolute paths and the extension shows relative ones.
- `source_files.ts`: parses the file map into data layers, snippet files and CSS files, and reports unknown names. `files` maps a path relative to the config directory (`keymap.d/10-x.toml`) to its text. A directory entry has a trailing slash in its key and empty text, and is unknown, or a problem when a file name was expected. A known directory name that holds a file is a problem too.
- `theme_dir.ts`: parses theme files, one theme per `<name>.toml`.
- `merge.ts`: merges the layers of each data kind and records where each value came from.
- `snippet.ts`: turns a snippet file header into a registry entry.
- `check.ts`: builds the registry with the snippets and checks bindings, args, engines and settings.
- `schemas.ts`: the editor schemas for the data files. Only the tool and tests call it.
- `errors.ts`: `ConfigErrors`, which collects every problem of one run.

`smol-toml` parses the TOML. A test fails when a file here imports a `node:` module.
