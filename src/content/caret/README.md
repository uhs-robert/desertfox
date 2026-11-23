# caret

The `caret` bundle (`caret.js`): caret mode, visual mode, line visual mode (`visual_line`) and page search.

Behavior is in `docs/design/interfaces_caret_search_marks.md`, section "Caret files for caret and search".

- `main.ts`: the bundle entry: the mode sinks and the `caret.*` and `visual.*` handlers, around `caret_session.ts`.
- `caret_session.ts`: the one caret or visual session: enter, exit, and adopting a selection a find, drag or click moved.
- `motion.ts`: vim motions over a plain string. Pure.
- `text_object.ts`: the text objects `aw`, `iw`, `as` and `is` as a cursor. Pure.
- `selection_state.ts`: the caret and anchor indexes, one motion step and the span a session selects. Pure.
- `text_model.ts`: the visible page text as one string plus a map from each character to a DOM position.
- `page_text.ts`: the one owner of the page text, shared by the caret session and page search. It says when a model is stale.
- `screen_line.ts`: the screen line motions (`j`, `k`, `0`, `^`, `$`) and the scroll that brings a character in view.
- `scroll_delta.ts`: how far a view scrolls to bring a box in.
- `start_point.ts`: where a new session starts with no hint: the first and last character on screen.
- `page_selection.ts`: the page's own selection as a span with its direction.
- `selection_mirror.ts`: the one writer of the page selections in a session, and the caret cell in caret mode.
- `selection_colors.ts`: the colors of the find highlights and the selection, read from the stored theme.
- `adopted_sheets.ts`: one adopted style sheet per tree. The find highlights and the selection colors both use it.
- `find_match.ts`: the pure half of page search: query to literal or regex search, and the scan in slices.
- `find_paint.ts`: draws the search matches with the CSS Custom Highlight API.
- `visible_range.ts`: which matches to draw around the on-screen range. Pure.
- `find_mode.ts`: the life of a character find (`f`, `t`) that shows its matches. Pure.
- `find_session.ts`: the search state for `/`, `?`, `n`, `N`, `*` and `#`.

Rules across files:

- `page_text.ts` owns the page text. Caret and search read it from there and keep no model of their own.
- `selection_mirror.ts` is the only writer of page selections. Only the sink's `enter` starts a session, in `caret_session.ts`.
- Pure files import no DOM or browser global. The regex scan runs in the background (`src/background/find_scan.ts`).
