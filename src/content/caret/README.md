# caret

The `caret` bundle (`caret.js`): caret mode and visual mode.

- `motion.ts`: vim motions over a plain string, a position being the index of the character under the caret. Pure. It leaves out the screen line motions `j`, `k`, `0`, `^` and `$`.
- `text_model.ts`: the visible page text as one string plus a map from each character to a DOM position. An empty line made by a `<br>` maps to the `<br>` in its parent. The walk follows the rendered order into open and closed shadow roots, slots and same-origin frames, up to 4 frames deep. A frame from another origin is left to its own content script. The model lists the trees (documents and shadow roots) its text comes from and cuts a span into one run per tree, because a Range or a style rule reaches into one tree only.
- `selection_state.ts`: the caret and anchor indexes, and one step of a motion in caret or visual mode. Pure.
- `screen_line.ts`: the screen line motions, asked of `Selection.modify` because only layout knows where text wraps, and the box of one character in this script's window. `j` and `k` keep a goal x across lines and pick the nearest character on the next line by measuring boxes. `Selection.modify` stays in one document, so where it stalls or steps over a frame, `j` and `k` take the model's next or previous line.
- `selection_colors.ts`: the lualine colors for the selection, from the compiled keymap in storage, in a style element per tree with text that lives as long as the session.
- `scroll_delta.ts`: how far a view scrolls to bring a box in.
- `copy_text.ts`: the clipboard write and the yank that follows it. Visual mode ends only if the session is still the one that started the copy.
- `start_point.ts`: where a new session starts with no hint: in the page's own selection if it is on screen, else the first visible text. A hint's element starts at its own text or the next text after it, which the model finds as it walks.
- `main.ts`: the sinks, the `caret.move` and `visual.act` handlers and the drawing. It paints one range per tree, each into the selection of its own document. Before each step it adopts a page selection if a find or a click moved it, and builds the model again if a frame or shadow host it read has left the page. A session starts in the sink's `enter` and ends in its `exit`, unless the page only moves between caret and visual mode. A hint on a frame from another origin shows a notice.

The caret is a one-character selection, because Firefox paints no caret on a collapsed selection in page text.
