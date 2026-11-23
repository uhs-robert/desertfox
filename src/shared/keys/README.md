# keys

Key notation, the prefix tree compiler and the matcher. Pure TypeScript, no browser APIs.

Behavior is in `docs/design/keys.md`, section "Keys files for keys".

- `token.ts`: the normalized key token and `event_to_token`. The compiler and the content script share it.
- `notation.ts`: parses a sequence such as `gx$` or `<AC-Escape>` into tokens.
- `compiler.ts`: builds the `CompiledKeymap`, with which-key labels and the expanded key groups.
- `prune_tree.ts`: copies a mode's tree with a `site_rules` row's `pass` or `only` keys applied.
- `matcher.ts`: walks the tree with count and register prefixes. It ships in the content script, so it stays small.
- `firefox_shortcut.ts`: turns a `browser` chord into a `commands.update` shortcut string.
- `default_keymap.ts`: the shipped keys, the source of `docs/keymap.md`. Data only, types-only imports.
- `index.ts`: re-exports `token`, `notation`, `compiler`, `matcher` and `firefox_shortcut`.

Rules across files:

- Import `prune_tree.ts` and `default_keymap.ts` directly, not through `index.ts`.
- The content script does not import `prune_tree.ts`.
