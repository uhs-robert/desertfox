# shared

Types and constants that fix the hand-off formats between the background page, the content script and `tools/build-config`. This folder holds no logic. Every other source folder may import from it, and it imports from none of them.

- `command.ts`: a command definition, and the `commands.json` entry cut from it.
- `invocation.ts`: the `Invocation` every caller produces, and a key binding.
- `keymap.ts`: keymap data as written by the user.
- `prefix_tree.ts`: the compiled keymap stored in `storage.local` for the content script.
- `messages.ts`: messages between content script and background.
- `config.ts`: the merged config file and the settings with their defaults.

The content script imports only types and `prefix_tree.ts` constants from here, so the 15 KB bundle stays small.
