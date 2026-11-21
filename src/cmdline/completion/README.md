# completion

What the command line list offers. Each file is pure: the page passes in the asking and the redraw. See [`../README.md`](../README.md) for how the page uses them.

- `tokenize.ts`: finds the word under the caret and what kind of thing it should be (command, flag, flag value or subject).
- `sources.ts`: builds the command, flag, value, engine, tab and bookmark rows with the one fuzzy scorer in `src/shared/score.ts`.
- `keys.ts`: reads the stored keymap once at open, for the keys column.
- `live.ts`: fetches bookmarks, engines and headings from the background once per kind and drops a reply that a newer fetch replaced.
- `model_client.ts`: holds the live tab model's rows from its snapshot and patches, and asks for a new snapshot after a gap.
- `ranked_client.ts`: the page's end of the rank port. It asks the background for the ranked rows of a word and keeps the last few answers.
- `anything.ts`: builds the finder's rows (`,,`) from the tabs and the background's answer, ranked as one list.
