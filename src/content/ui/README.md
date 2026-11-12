# ui

The `ui` bundle (`ui.js`), which the content script loads on first use. It draws the mode badge and the toast (a short message that disappears after 3 seconds).

- `main.ts`: the bundle entry. It registers three handlers with the host: `ui.hand_focus` (the hand-off below), `ui.toast` (shows `args.message`, styled by the optional `args.kind`: error, warning, info or success, error when unset) and `ui.badge` (sets `args.label` and `args.mode`, and removes the badge when the label is undefined). A second run does not register again.
- `hand_focus.ts`: the hand-off of a hidden input frame to its parent document, with the guard time against a page that fights for the focus. content.js asks for it only in a frame with a frame element, so a top frame never loads this bundle for it.

The drawing code is in `../toast.ts` and `../mode_indicator.ts`. Both draw in a closed shadow root made by `../surface.ts`. Only this bundle runs them. 

Other code does not import the bundle. It calls `../ui_proxy.ts`:

- `show_toast(message, kind?)`: shows a toast.
- `show_mode_label(state?)`: shows the badge for a mode, pass-next flag, setting and recording name, and no state removes the badge. Only the top frame draws it.

Both calls load the bundle if needed. A call made before the load finishes waits and runs after it. The proxy holds no keys while it waits. `copy.ts` in `../handlers/` is an example of a caller. The mode wiring in `../main.ts` sets the badge.
