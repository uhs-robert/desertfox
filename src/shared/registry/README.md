# registry

The command registry and everything that reads a command definition. Pure TypeScript with no browser APIs, so the background page and Node tools share it.

Behavior is in `docs/design/registry.md`, section "Registry files for the registry".

- `define.ts`: `create_registry` and the define-time checks.
- `check_args.ts`: the one validator, and the home of every static argument rule.
- `check_shape.ts`: the shape checks of the validator, without the setting value text.
- `params.ts`: small readers over params, such as `default_of` and the subject param.
- `command_line.ts`: the grammar for command text, text to `Invocation`.
- `parse_binding.ts`: the same grammar for a config binding, plus the leading `:`.
- `print_command.ts`: the inverse of `command_line.ts`, an invocation back to text.
- `single_quote.ts`: one word of command line text in single quotes.
- `usage.ts`: the usage line for `-h` and `flag_alternatives`.
- `summary.ts`: the summary rule for an `intent` and its checks.
- `commands_file.ts`: the `commands.json` content.
- `builtin.ts`: the shared `registry` and `define` singleton.
- `index.ts`: the exports of types and helpers. It runs nothing at import.

Rules across files:

- The Node tool `tools/write_commands_json.mjs` loads this folder straight from source.
- Never import `builtin.ts` from a page, the content script or help. `test/registry/bundle_free.test.ts` fails when one does.
- The command line page imports `check_shape.ts` directly, not `check_args.ts`.
