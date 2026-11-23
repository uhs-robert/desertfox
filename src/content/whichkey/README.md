# whichkey

The which-key panel: a floating list of the keys that can follow what the user has typed. It ships as the `whichkey` bundle, which the content script loads on first use.

Behavior is in `docs/design/interfaces_pages.md`, section "Which-key files for the which-key panel".

- `main.ts`: the bundle entry: the `whichkey`, `help.whichkey` and `whichkey.media_panel` handlers, and the relay from a subframe.
- `relayed_panel.ts`: the panel a subframe draws through the top frame, with its message order check.
- `media_panel.ts`: the panel that the media mode opens.
- `session.ts`: decides whether an answer from the background may still be drawn.
- `guarded_rows.ts`: `rows_for_page`, which drops a row whose `chain` holds no leaf in this frame.
- `panel.ts`: draws the panel in a closed shadow root.
- `style.ts`: the panel's sheet (`STYLE`). Pure text with no imports.
- `layout.ts`: the column count and the title fit. Pure text with no imports.
- `timer.ts`: starts the panel after a pause in a half-typed sequence.

Rules across files:

- `style.ts` and `layout.ts` import nothing, so DesertBird can vendor both.
- The data comes from `src/background/list_keys.ts` through the `list_keys` message. See `src/background/README.md`.
