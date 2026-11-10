# build-config

Lints the user config directory. It merges the files, parses snippets and key bindings, and checks every argument and theme, with the same code the extension runs on `config.reload`. It writes nothing Firefox reads. `docs/design.md` describes the config format.

The merge, check and parse code lives in `src/shared/config_build/` (see its README) and uses no Node API. This folder holds what needs Node:

- `cli.ts`: the command line.
- `build_config.ts`: reads `commands.json`, then runs the shared `build_config` on the directory's files.
- `source_files.ts`: reads the config directory into the raw file map (`read_config_files`).
- `theme_dir.ts`: reads the repo `themes/` folder for `tools/build_themes.ts`.
- `output.ts`: writes the data schemas.

## Run

```
just build-config [dir] [flags]
node tools/build-config/cli.ts [dir] [flags]
```

`just build-config` builds the extension first and forwards the flags. The `node` form needs `dist/commands.json` to exist already. `just build` (or `npm run build`) writes it.

- `dir`: the config directory. Defaults to `~/.config/desertfox`.
- `--commands <file>`: the command list from the build. Defaults to `dist/commands.json`.
- `--schemas <dir>`: also write the data schemas into this directory.

It prints config warnings to stderr and exits with 1 on a config error. A bare run writes no file.

To apply an edit, run `config.reload` (`<Space>r`) in Firefox. That reads the files through the native host, which is optional: browser edits cover casual use, and only the config files (TOML, snippets and CSS) need the host.

Older versions wrote `~/.mozilla/managed-storage/desertfox@uhs-robert.json` and a `.engines.jsonl` beside it. Firefox now ignores that file. It is safe to delete.
