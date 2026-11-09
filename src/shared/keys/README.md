# keys

Key notation, the prefix tree compiler and the matcher. Pure TypeScript, no browser APIs.

- `token.ts`: the normalized key token and `event_to_token`. The compiler and the content script both use it, so a keymap sequence and a keydown meet in one form.
- `notation.ts`: parses a sequence such as `gx$` or `<AC-Escape>` into tokens.
- `compiler.ts`: builds the `CompiledKeymap`, gives every leaf its which-key label (the binding `label`, else the command label with the phrases of the args the binding sets, and the binding `intent` when it has one), expands `search_keys`, `container_keys` and `site_keys` (the `s/<letter>` and `S/<letter>` leaves, which carry their candidate engines in `site_search`), expands `modifiers` into variant keys that the registry validator accepts (the modifier label names the group), puts `group_names` on the branches, and warns about shadowed or unknown entries.
- `matcher.ts`: walks the tree with count prefixes. `binds_after` reads ahead without moving the walk, so key_flow can tell which keys typed during a bundle load can bind. It ships in the content script, so it stays small.
- `firefox_shortcut.ts`: turns a `browser` chord into a `commands.update` shortcut string.
