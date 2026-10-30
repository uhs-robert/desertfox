# keys

Key notation, the prefix tree compiler and the matcher. Pure TypeScript, no browser APIs.

- `token.ts`: the normalized key token and `event_to_token`. The compiler and the content script both use it, so a keymap sequence and a keydown meet in one form.
- `notation.ts`: parses a sequence such as `gx$` or `<AC-Escape>` into tokens.
- `compiler.ts`: builds the `CompiledKeymap`, expands `search_keys` and `container_keys`, and warns about shadowed or unknown entries.
- `matcher.ts`: walks the tree with count prefixes. It ships in the content script, so it stays small.
- `firefox_shortcut.ts`: turns a `browser` chord into a `commands.update` shortcut string.
