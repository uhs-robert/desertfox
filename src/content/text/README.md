# text

The `text` bundle (`text.js`): records the text typed in one insert session and types it back for `.`. The background injects it on the first input event in a text field.

Behavior is in `docs/design/interfaces_caret_search_marks.md`, section "Text files for the text bundle".

- `main.ts`: registers `text.input`, `text.flush`, `text.insert` and `register.paste`.
- `recorder.ts`: the session: takes the field's text, and records what an edit put in. Pure.

Rules across files:

- `../main.ts` keeps two hooks that must not wait for this bundle: the `beforeinput` listener and the flush.
- `main.ts` and the `editor` bundle call `is_secret_field`, and the `editor` bundle and the hint keys call `type_at_caret` in `field_writer.ts`. Both live in `../lib/`.
- The text goes to `storage.session` only, never `storage.local`.
