# config

The stored config and the browser state that goes with it. `config_load.ts` touches `browser.storage`, so the background and every extension page import it. `storage_keys.ts` lists the local keys.

- `config_load.ts`: `pick_config` picks the config to run, `load_effective_config` adds the edits for pages, `load_edits` and `store_edits` hold the edits, `build_config_status` builds the status.
- `storage_keys.ts`: every `storage.local` key the background owns. The keymap key is in `prefix_tree.ts`, the theme and user CSS keys in `theme/apply.ts`.
