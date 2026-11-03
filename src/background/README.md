# background

The background page. It loads the config, compiles the keymap, assigns the Firefox shortcut slots and routes run requests.

- `main.ts`: registers the listeners, then waits for the config.
- `startup.ts`: load, compile, publish to `storage.local`, tell open tabs.
- `config_load.ts`, `keymap_merge.ts`, `compile.ts`: managed config over imported config, default keymap under user keymap, and the args check per binding.
- `default_keymap.ts`: the shipped keys, one for each `v1` row of `docs/keymap.md` whose command exists. Keys that need the user's engines or containers are left to the config. A binding with `prompt` compiles to a background step, and the router refuses it until phase 2.
- `slots.ts`: `browser` chords to the 10 manifest slots.
- `tab_modes.ts`: the mode each tab last reported, in `storage.local`, and the ignore-mode gate for Firefox shortcuts.
- `router.ts`: the one entry for run requests. Its pieces are `count.ts` and `refusal.ts`.
- `bundle_loader.ts`: injects a bundle into a frame when the content script asks, once per document. It joins repeat asks, answers a failure or a missed deadline with a refusal, and checks the bundle name because the sender is a page script.
- `load_log.ts`: the last 20 bundle loads in storage, which the key test reads. Writes run one at a time and a storage failure is dropped, so the log never fails a load. Pure.
- `snippets.ts`: the user's snippets as commands. `matches` is checked here against the tab URL, the code runs in the top frame only, and `oasisfox.run` calls come back through the `snippet_run` message with the caller's depth (limit 5).
- `reload.ts`: the marker and the tab repair behind `config.reload`.
- `browser_deps.ts`: the only file that wires the router to Firefox calls.
- `command_modules.ts`: one import per command group. Add the group to `COMMAND_MODULES` in `tools/write_commands_json.mjs` too.

Everything except `browser_deps.ts` and `startup.ts` takes its browser access as arguments, so tests run without a browser.
