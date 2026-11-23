# config_build

Builds the merged config from the user's config files.

It takes raw file text and the command list, and uses no Node API.

Behavior is in `docs/design/config.md`, section "Config build files for the config".

- `build_config.ts`: `build_config`, the whole pipeline, and `commands_of_registry`.
- `source_files.ts`: parses the file map into data layers, snippet files and CSS files.
- `theme_dir.ts`: parses theme files, one theme per `<name>.toml`.
- `merge.ts`: merges the layers of each data kind and records where each value came from.
- `snippet.ts`: turns a snippet file header into a registry entry.
- `check.ts`: builds the registry with the snippets and checks bindings, args, engines and settings.
- `resolve_binding.ts`: turns one config binding into invocations. The keymap, the site rows and the compile share it.
- `schemas.ts`: the editor schemas for the data files. Only the tool and tests call it.
- `errors.ts`: `ConfigErrors`, which collects every problem of one run.

Rules across files:

- The extension and `tools/build-config` both run it. `tools/build-config/README.md` lists what stays in the tool.
- In the extension, only the background runs it. Two files import one module from it, and no others do:
  - The help page file `src/help/keys_page.ts` takes `KEYMAP_MODES` from `merge.ts`.
  - The shared file `src/shared/config_file_path.ts` takes `DATA_KINDS` from `source_files.ts`.
- No file here imports a `node:` module. A test fails when one does.
