# config

The stored config and the browser state that goes with it. `config_load.ts` touches `browser.storage`, so the background and every extension page import it. `storage_keys.ts` is the one list of the `storage.local` keys the background owns.

- `config_load.ts`: reads the stored config, checks its settings against `SETTING_SPECS`, and holds the edits. `storage.local` keeps the consent settings and values an older version saved; `storage.session` holds temp edits (`load_edits`, `store_edits`).
- `storage_keys.ts`: every `storage.local` key the background owns. The keymap key is in `prefix_tree.ts`, the theme and user CSS keys in `theme/apply.ts`.
