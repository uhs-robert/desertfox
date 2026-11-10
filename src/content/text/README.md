# text

The `text` bundle (`text.js`, 4 KB limit). It records the text typed in one insert session and types it back for `.`. The background injects it into a frame on the first input event in a text field.

- `content/main.ts` keeps two hooks that must not wait for the bundle: a window `input` listener and one flush call before each leaf runs. Each forwards through `run_command_`, which waits on the load and then runs its calls in order, so the first characters after `gi` are not lost and a flush runs after the input before it.
- `recorder.ts`: the session. Text comes from `input` events (`insertText`, a paste, a line break, a backspace on the session's own text). It ends on a flush, which the bundle also calls on `focusout` (Escape blurs the field, so it needs no hook of its own) and `pagehide`, and a second flush records nothing. A session records `text.insert` through the same `record_step` message as a content leaf, led by the entry command when one focused the field. Pure, unit tested.
- `entry.ts`: the entry (decision D1 of the dot-repeat plan). `page.focus_input`, `page.focus_field` and a hint pick that ended in insert mode mark the field they focused on `window`, and the first session in that field takes the mark. A field focused by a click has none, so its replay types into the field the last Escape left.
- `secret_field.ts`: `is_secret_field`, the one test for a field whose text is never recorded (a password input). Register writes and the macro recorder call it too.
- `field_writer.ts`: `write_into_field`, the one writer of text into a field, through `execCommand("insertText")` so React and Vue fields see a real input event. It refuses with `RuntimeRefusal` when no field is focused and none was left. Hint keys and `<C-r>` paste use it through `type_at_caret`.
- `main.ts`: registers `text.input`, `text.flush` and `text.insert`. A replay runs under `while_replaying`, so its own input events do not record themselves.

The text goes to `storage.session` only (the `.` slot, which a private window has its own copy of), never `storage.local`. Rich editors that ignore `execCommand` and IME composition are not recorded.
