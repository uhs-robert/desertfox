# registry

The command registry and everything that reads a command definition. Pure TypeScript with no browser APIs, so the background page and Node tools share it. `tools/write_commands_json.mjs` loads it straight from source.

- `define.ts`: `create_registry` and the define-time checks. Every rejection is a `DefineError` that names the command and the field. Snippet commands go through the same `define`, so they share the name check.
- `check_args.ts`: the one validator. Runtime enum lists (engines, containers) arrive as an `EnumSources` argument.
- `command_line.ts`: the one grammar for command text, text to `Invocation`. It never checks `when` or types. Call `check_args` on the result.
- `parse_binding.ts`: the same grammar for a config binding, plus the leading `:` that turns into a stored `prompt`.
- `usage.ts`: the usage line shown for `-h`.
- `commands_file.ts`: the `commands.json` content.
- `params.ts`: small readers over params shared by the files above.
- `index.ts`: the shared `registry` and `define`, plus the exports.

Context-source defaults (`{ from: "selection" }`) stay in the checked args as markers. The router fills them.
