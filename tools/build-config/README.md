# build-config

Compiles the user config directory into the managed storage config that the extension reads. It merges the files, parses snippets and key bindings, checks every argument and theme, and writes one JSON file. `docs/design.md` describes the config format.

## Run

```
just build-config [dir] [flags]
node tools/build-config/cli.ts [dir] [flags]
```

`just build-config` builds the extension first. The `node` form needs `dist/commands.json` to exist already.

- `dir`: the config directory. Defaults to `~/.config/oasisfox`.
- `--commands <file>`: the command list from the build. Defaults to `dist/commands.json`.
- `--out <file>`: where to write the managed storage file. See the trap below.
- `--schemas <dir>`: also write the data schemas into this directory.

Next to the output it writes `<out without .json>.engines.jsonl`, the resolved search engines, one per line. It prints config warnings to stderr and exits with 1 on a config error.

## Trap: the default output is the live config

Without `--out`, the CLI writes `~/.mozilla/managed-storage/oasisfox@uhs-robert.json`, the file Firefox reads. A test run without `--out` overwrites the real config. Always pass `--out` for a trial run:

```
just build-config path/to/config_dir --out /tmp/oasisfox_test.json
```
