# ui

The `ui` bundle (`ui.js`), which the content script loads on first use. It draws the mode badge and the toast (a short message that disappears after 3 seconds).

- `main.ts`: the bundle entry. It registers two handlers with the host: `ui.toast` (shows `args.message`, styled by the optional `args.kind`: error, warning, info or success, error when unset) and `ui.badge` (sets `args.label` and `args.mode`, and removes the badge when the label is undefined). A second run does not register again.

The drawing code is in `../toast.ts` and `../mode_indicator.ts`. Both draw in a closed shadow root made by `../surface.ts`. Only this bundle runs them. 

Other code does not import the bundle. It calls `../ui_proxy.ts`:

- `show_toast(message, kind?)`: shows a toast.
- `show_mode_label(label, mode?)`: sets the badge text and the mode that picks its theme color, and a label of `undefined` removes the badge. Only the top frame draws it.

Both calls load the bundle if needed. A call made before the load finishes waits and runs after it. The proxy holds no keys while it waits. `copy.ts` in `../handlers/` is an example of a caller. The mode wiring in `../main.ts` sets the badge.
