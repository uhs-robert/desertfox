# editor

The `editor` bundle (`editor.js`, 4 KB limit). The background injects it into a frame on the first `text.edit_external` (`<C-i>` in insert mode).

- `main.ts`: the handler reads the focused field and refuses a non-editable focus, a password field (`is_secret_field`) and text over the host's 128 KiB cap, then sends `editor_open` to the background with a fresh token. The background answers with a refusal (a second editor in the tab, a host error), which the key shows as a toast. The edit stays in a page-local map by token, with the field and its text at the press. When `editor_done` arrives, an unchanged field takes the result through `execCommand("insertText")` over its whole content (`delete` for an empty result). A field that changed or left the page keeps its text, and the result goes to the unnamed register with a toast. A message with an unknown token (another page) is ignored.
