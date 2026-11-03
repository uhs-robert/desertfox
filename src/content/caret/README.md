# caret

The `caret` bundle (`caret.js`): caret mode and visual mode.

- `motion.ts`: vim motions over a plain string, a position being the index of the character under the caret. Pure. Lines are the text blocks of the page, so a wrapped paragraph is one line for `j`, `k`, `0` and `$`.
- `text_model.ts`: the visible page text as one string plus a map from each character to a DOM position.
- `selection_state.ts`: the caret and anchor indexes, and one step of a motion in caret or visual mode. Pure.
- `start_point.ts`: where a new session starts, in the page's own selection if it is on screen, else the first visible text.
- `main.ts`: the sinks, the `caret.move` and `visual.act` handlers and the drawing.

The caret is a one-character selection, because Firefox paints no caret on a collapsed selection in page text. A session starts on the first key in the mode, because a sink gets no call on entry.
