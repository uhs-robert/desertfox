# editor

The `editor` bundle (`editor.js`): edits a focused field in the external editor. Behavior is in `docs/design/interfaces_pages.md`, section "Editor files for the external editor".

- `main.ts`: the `text.edit_external` handler: reads the focused field, opens the editor through the background and writes the result back.
- `clipboard_fallback.ts`: the clipboard path for editors that show only part of their text (CodeMirror, Ace, Monaco).

Rules across files:

- The content script asks the background for the bundle on the first `text.edit_external`, and the background injects it.
- `clipboard_fallback.ts` copies through `exec_clipboard_command` in `src/content/site_actions/clipboard.ts`.
