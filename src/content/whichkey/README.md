# whichkey

The which-key panel: a floating list of the keys that can follow what the user has typed. It ships as the `whichkey` bundle, which the content script loads on first use.

- `main.ts`: the bundle entry. Registers the `whichkey` handler (with a prefix it shows the panel, without one it hides it) and the `help.whichkey` handler (lists the first keys of the mode). A second run does not register again.
- `session.ts`: decides whether an answer from the background may still be drawn. It skips modes that have no keymap to list, and drops an answer when the next key arrived first or a hide came in between.
- `panel.ts`: draws the panel in a closed shadow root: the title chip in the top border, a row per key, a footer. It also owns the styles.
- `layout.ts`: how many columns the rows need for the viewport height.

The data comes from `src/background/list_keys.ts`, through the `list_keys` message. It builds the `WhichKeyPanel`: the title (the chain of group names, `+Go >> +Close tabs`), the rows and the border style. See `src/background/README.md`.
