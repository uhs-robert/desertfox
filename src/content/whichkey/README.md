# whichkey

The which-key panel: a floating list of the keys that can follow what the user has typed. It ships as the `whichkey` bundle, which the content script loads on first use.

- `main.ts`: the bundle entry. Registers the `whichkey` handler (with a prefix it shows the panel, without one it hides it) the `help.whichkey` handler (lists the first keys of the mode) and the `whichkey.media_panel` handler (the background's open on entering the media mode, which `media_panel.ts` admits only while the frame is still in media mode and not in full screen). A second run does not register again.
- In a subframe, `main.ts` draws and erases through the top frame (`whichkey.draw`, `whichkey.erase`, relayed by the background), so the panel shows where the user looks and lists the subframe's own keys. Each message carries a count, and `arrival.ts` drops one that arrives after a newer one from the same frame. A top frame that does not answer leaves the panel in the subframe.
- `session.ts`: decides whether an answer from the background may still be drawn. It skips modes that have no keymap to list, and drops an answer when the next key arrived first or a hide came in between.
- `panel.ts`: draws the panel in a closed shadow root: the title chip in the top border, a row per key, a footer. The footer ends with a `.` line when the panel carries `repeat`. It also owns the styles.
- `layout.ts`: how many columns the rows need for the viewport height, and how the title chain joins and shortens (`fit_title`: whole groups drop from the start and "…" stands for them).

`main.ts` fills `repeat` from a second message, `read_repeat_preview`, sent beside `list_keys`. The background answers with text built in `repeat_preview` (`src/background/repeat_memory.ts`), or nothing when the `which_key_repeat` setting is off.

The data comes from `src/background/list_keys.ts`, through the `list_keys` message. It builds the `WhichKeyPanel`: the title (the chain of group names, `["+Go", "+Close tabs"]`, which the panel joins as `+Go » +Close tabs`), the rows and the border style. See `src/background/README.md`.
