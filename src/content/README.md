# content

The content script. It runs at `document_start` in the top frame and in same-origin frames.

- `main.ts`: the capture listener, the storage read, messages and mode wiring. Not unit tested, it needs a DOM.
- `key_flow.ts`: decides per key token whether the page keeps the key, hands tokens to the sink of the current mode, runs `browser` chords, holds plain keys until the keymap is read or a bundle has loaded and replays them in order. Pure.
- `bundle_host.ts`, `bundles.ts`: load bundles on first use and keep what they register. A bundle is a script the background injects into this frame (`hints.js`, `caret.js`, `whichkey.js`, `cmdline.js`, `ui.js`). It registers a sink per mode and a handler per command through `window.oasisfox_host`. `bundles` is the one instance. A bundle may run twice, for example after a missed deadline, so its setup must be safe to repeat. `sink.exit()` may run after the sink has already cleaned up.
- `cancelled_keys.ts`: the keys whose keydown was cancelled, so their keypress and keyup are cancelled too. Pure.
- `mode_state.ts`, `page_mode.ts`: the modes and the pass-next flag. `page_mode` is the one shared instance.
- `plan_steps.ts`, `invocation_args.ts`: split a leaf into ordered runs and apply a command's count rule. Pure.
- `scroll_target.ts`, `match_pattern.ts`, `editable.ts`: pure helpers for scroll choice, `ignore_sites` and focus.
- `handlers/`: one plain function per content command. `handler_map.ts` is the only id-to-code link. The definitions in `src/commands` import the same handler objects, so the count rule lives in one place.
- `surface.ts`, `toast.ts`: the closed shadow root and the message surface for refusals. Only the `ui` bundle imports them.
- `ui_proxy.ts`, `ui/main.ts`: `show_toast` and `show_mode_label` as the rest of the script calls them. They ask the `ui` bundle (`ui.js`), which holds the toast and the badge, and a call made before it loads waits and runs after. Neither holds keys. The help page loads `ui.js` by script tag, because `executeScript` is refused there.
- `mode_label.ts`, `mode_indicator.ts`: the badge text (pure) and the badge (in the `ui` bundle), top frame only. It follows the `mode_indicator` setting and sits 8 px above the bottom edge. Its colors come from `mode_colors` in the compiled keymap, which the background cuts from the `palette` setting (the page picks dark or light from the system theme), so this bundle holds no palette table.

The key test reads `data-oasisfox-tree-read-ms` and `data-oasisfox-tree-ready-at-ms` on the document element.
