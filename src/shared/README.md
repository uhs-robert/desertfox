# shared

Types and constants that fix the hand-off formats between the background page, the content script and `tools/build-config`. Apart from `registry/`, `keys/`, `match_pattern.ts` and `mode_colors.ts`, this folder holds no logic. Every other source folder may import from it, and it imports from none of them.

- `command.ts`: a command definition, and the `commands.json` entry cut from it.
- `invocation.ts`: the `Invocation` every caller produces, and a key binding.
- `keymap.ts`: keymap data as written by the user.
- `prefix_tree.ts`: the compiled keymap stored in `storage.local` for the content script.
- `messages.ts`: messages between content script and background.
- `registry/`: the command registry, the one validator and the command line parser. See its README.
- `keys/`: key notation, the prefix tree compiler and the matcher. See its README.
- `mode_colors.ts`: the 16 oasis palettes and the lookup that cuts one down to the badge colors per mode. Only the background imports the lookup, so the content script gets the few colors it needs through the compiled keymap.
- `match_pattern.ts`: WebExtension match patterns. `ignore_sites` (content script) and snippet `matches` (background) both use it.
- `config.ts`: the merged config file and the settings with their defaults.

The content script imports only types, `prefix_tree.ts` constants and `match_pattern.ts` from here, so the 15 KB bundle stays small.
