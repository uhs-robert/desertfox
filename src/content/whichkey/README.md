# whichkey

The which-key panel: a floating list of the keys that can follow what the user has typed. It ships as the `whichkey` bundle, which the content script loads on first use.

- `main.ts`: the bundle entry. Registers the `whichkey` handler (with a prefix it shows the panel, without one it hides it) the `help.whichkey` handler (lists the first keys of the mode) and the `whichkey.media_panel` handler (the background's open on entering the media mode, which `media_panel.ts` admits only while the frame is still in media mode and not in full screen). A second run does not register again.
- In a subframe, `main.ts` draws and erases through the top frame (`whichkey.draw`, `whichkey.erase`, relayed by the background), so the panel shows where the user looks and lists the subframe's own keys. Each message carries a count that starts at the document's start time, and `relayed_panel.ts` drops one that arrives after a newer one from the same frame, also across a new document in that frame. An erase hides only a panel the erasing frame drew, never the top frame's own. A subframe erases its relayed panel on `pagehide`. A top frame that does not answer leaves the panel in the subframe.
- `session.ts`: decides whether an answer from the background may still be drawn. It skips modes that have no keymap to list, and drops an answer when the next key arrived first or a hide came in between.
- `guarded_rows.ts`: `rows_for_page`, which `main.ts` runs on each answer. A row with a `chain` (a key guarded by `when_focus` or `when_present`, which the background cannot test) goes when no leaf of the chain holds in this frame, and shows the label of the leaf that does.
- `panel.ts`: draws the panel in a closed shadow root: the title chip in the top border, a row per key, a footer. The footer ends with a `.` line when the panel carries `repeat`.
- `style.ts`: the panel's sheet (`STYLE`). Pure text with no imports, like `layout.ts`, so DesertBird can vendor both.
- `layout.ts`: how many columns the rows need for the viewport height, and how the title chain joins and shortens (`fit_title`: whole groups drop from the start and "…" stands for them).
- `../gate.ts`: the `content.js` side. It decides which prefix changes reach the bundle, which holds the timer.
- `timer.ts`: starts the panel after a pause in a half-typed sequence. The next key, a reset or a mode change cancels it.

`main.ts` fills `repeat` from a second message, `read_repeat_preview`, sent beside `list_keys`. The background answers with text built in `repeat_preview` (`src/background/repeat_memory.ts`), or nothing when the `which_key_repeat` setting is off.

The data comes from `src/background/list_keys.ts`, through the `list_keys` message. It builds the `WhichKeyPanel`: the title (the chain of group names, `["+Go", "+Close tabs"]`, which the panel joins as `+Go » +Close tabs`), the rows and the border style. See `src/background/README.md`.
