# completion

What the command line list offers, plus the tab rows the new tab page reads. Each file is pure: the page passes in the asking and the redraw. `src/cmdline/README.md` says how the page uses them.

- `tab_rows.ts`: the tab, bookmark and closed-tab rows built from browser data. The command line lists and the new tab page read them.
- `tokenize.ts`: finds the word under the caret and its class (command, flag, flag value or subject). A subject also carries the flags typed before it, so `bookmark --folder=` narrows the list.
- `sources.ts`: builds the command, flag, value, engine, tab and bookmark rows with the one fuzzy scorer in `src/shared/score.ts`. A subject naming one list entry completes on all its words.
- `keys.ts`: reads the stored keymap once at open, for the keys column: the keys that run a command bare, two shown then `+N`, from the line's mode and `browser`.
- `live.ts`: fetches bookmarks, engines and headings from the background once per kind and drops a reply that a newer fetch or the close of the line replaced.
- `ranked_client.ts`: the page's end of the rank port. One request in flight per line, the newest word waits, keeps the last 4 answers, clears them on `stale`. Details in the design.
- `anything.ts`: the finder's rows (`,,`): tabs ranked here, the background's answer merged by score, a row a tab already holds dropped. Rows carry a `ref` for submit. Details in the design.
- `word_lookup.ts`: finds a command by name, alias or id the way the registry does, for the page and the omnibox, which have no registry.
- `model_client.ts`: holds the tab model's rows from its snapshot and patches, asks for a new snapshot on a gap in `rev`. The line's window comes first, and `%` and `#` show only there.
