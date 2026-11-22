# content

The content script, run in every frame at `document_start`. Start in `main.ts`. Behavior: `docs/design/bundles.md`, `docs/design/keys.md`, `docs/design/interfaces_pages.md`.

Rules that span files:

- Lazy bundles import `surface.ts`, `content.js` never does.
- A property name that ends in `_` is mangled by the build in every bundle. Add it only to a name that stays inside the extension scripts.
- A bundle folder imports only itself, these root files, `lib/` and `src/shared`, never another bundle folder.
- `lib/` imports only the root files and `src/shared`. The edges left are listed in `test/import_boundaries.ts`, each with the PR that removes it.
- Test hooks (`data-desertfox-*` attributes) exist only under `KEY_TEST_BUILD`, except `data-desertfox-layer`.

Entries:

- `main.ts`: capture listener, message and mode wiring, the `blur_on_load` window. Not unit tested, it needs a DOM.
- `strip_setting.ts`: the background ask for the `strip_tracking_params` names (`shared/copy/strip_tracking.ts` applies them).
- `ask_keymap.ts`: asks the background for the page's keymap at start and on `tree_updated`.
- `gate.ts`: which prefix changes reach the `whichkey` bundle, which holds the timer. `content.js` side of the which-key panel.
- `key_flow.ts`: routes each key token: page, mode sink, `browser` chord or hold. Pure.
- `run_leaf.ts`: runs a matched leaf here or sends it to the router. `holds_keys_after` says whether keys wait.
- `leaf_for_page.ts`: picks the leaf under a site bind's `when_focus` and `when_present` guards.
- `replay_key.ts`: the synthetic keydown that hands a held key back to the page. Pure.
- `cancelled_keys.ts`: keys whose keydown was cancelled, so their keypress and keyup are too. Pure.
- `site_mode.ts`, `site_rule.ts`: the site mode in force and what a site rule change does to it.
- `mode_state.ts`, `page_mode.ts`: the modes, the pass-next flag and the one shared instance.
- `mode_report.ts`: each frame reports its mode to the background on change.
- `badge_state.ts`, `mode_indicator.ts`: what the badge shows and the badge draw, top frame only.
- `bundle_calls.ts`: type map of the handlers bundles call in each other. Types only.
- `bundle_host.ts`, `bundles.ts`: load bundles on first use and keep what they register (`window.desertfox_host`).
- `relay.ts`: asks the background to run a handler in the top frame or another frame.
- `run_content.ts`: runs an invocation or a list and answers an `Outcome` that never rejects.
- `invocation_args.ts`: applies a command's count rule. Pure.
- `lib/`: code that more than one bundle (or `content.js` and a bundle) needs. See its README.
- `handlers/`: one plain function per content command. `handler_map.ts` is the only id-to-code link.
- `surface.ts`, `toast.ts`: the top-layer shadow-root host and the toast surface.
- `ui_proxy.ts`: `show_toast_` and `show_mode_label`, calls into the `ui` bundle.
- `scroll_target.ts`, `scroll_box.ts`, `align_target.ts`, `smooth_behavior.ts`: scroll box choice, align target, smooth or instant.
- `editable.ts`, `hidden_frame.ts`: the frame's editable rules and the hidden input frame size test.
- `shown.ts`: `is_shown`, the visibility rule for `page.item`, `page.click` and `when_present`.
- `pointer_events.ts`: pointer and mouse events of a real mouse, shared by hover picks.
- `user_left.ts`: `watch_user_left` marks the user as gone, read by load waits.
- `player_box.ts`: the element that goes fullscreen for a media element. Pure.
- `badge_hosts.ts`, `shadow.ts`: badge host marking for cleanup, closed shadow root access.
- `item/`, `item_act/`, `tree/`, `whichkey/`: bundle folders with their own README.
