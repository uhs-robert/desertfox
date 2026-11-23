# text

The `text` bundle (`text.js`): records the text typed in one insert session and types it back for `.`. The background injects it on the first input event in a text field.

Behavior is in `docs/design/interfaces_caret_search_marks.md`, section "Text files for the text bundle".

- `main.ts`: registers `text.input`, `text.flush`, `text.insert` and `register.paste`.
- `recorder.ts`: the session: takes the field's text, and records what an edit put in. Pure.
- `entry.ts`: the entry command mark that a focused field carries to its first session.
- `host_editable.ts`: `is_editable_in_frame`, the field check of this bundle.
- `secret_field.ts`: `is_secret_field`, the one test for a field whose text is never recorded.
- `field_writer.ts`: `write_into_field`, the one writer of text into a field.

Rules across files:

- `../main.ts` keeps two hooks that must not wait for this bundle: the `beforeinput` listener and the flush.
- `main.ts` and the `editor` bundle call `is_secret_field`. The `editor` bundle and the hint keys call `type_at_caret` in `field_writer.ts`.
- The text goes to `storage.session` only, never `storage.local`.
