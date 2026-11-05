# build-config

Compiles the user config directory into the managed storage config that the extension reads. It merges the files, parses snippets and key bindings, checks every argument and theme, and writes one JSON file. `docs/design.md` describes the config format.

## Run

```
just build-config [dir]
node tools/build-config/cli.ts [dir] (--out <file> | --live) [flags]
```

`just build-config` builds the extension first and writes the live config. The `node` form needs `dist/commands.json` to exist already. `just build` (or `npm run build`) writes it.

- `dir`: the config directory. Defaults to `~/.config/oasisfox`.
- `--live`: write `~/.mozilla/managed-storage/oasisfox@uhs-robert.json`, the file Firefox reads.
- `--out <file>`: write the managed storage file here instead.
- `--commands <file>`: the command list from the build. Defaults to `dist/commands.json`.
- `--schemas <dir>`: also write the data schemas into this directory.

Pass exactly one of `--live` and `--out`. With neither or both, the CLI exits with 2 and writes nothing, so a trial run never reaches the live config by accident. Use `--out` for a trial run:

```
node tools/build-config/cli.ts path/to/config_dir --out /tmp/oasisfox_test.json
```

Next to the output it writes `<out without .json>.engines.jsonl`, the resolved search engines, one per line. With `--live` that file lands in the live directory too. It prints config warnings to stderr and exits with 1 on a config error.
