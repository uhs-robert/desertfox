# ui

The `ui` bundle (`ui.js`): draws the mode badge and the toast. The content script loads it on first use.

Behavior is in `docs/design/bundles.md`, section "UI files for the ui bundle".

- `main.ts`: the bundle entry: registers the `ui.toast` and `ui.badge` handlers.
- `frame_hide_watch.ts`: the top frame watches the child frame that holds the keys and takes the focus back when it hides.

Rules across files:

- The drawing code is in `src/content/toast.ts` and `src/content/mode_indicator.ts`, both over `src/content/surface.ts`. Only this bundle runs them.
- Other code does not import the bundle. It calls `show_toast` or `show_mode_label` in `src/content/ui_proxy.ts`.
