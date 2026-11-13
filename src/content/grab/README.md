# grab

The `grab` bundle (`grab.js`): keyboard drag. `hint --grab` (`;g`) picks an element, then a target, and drives a drag between them. `hint --grab_move` (`;G`) picks an element and enters grab mode, where `h j k l` move it, Enter drops it and Escape puts it back and drops it.

- `main.ts`: the `grab.mode` handler that takes a hint pick (the hints bundle leaves the element in `desertfox_pick_target`, as for the caret), the `grab.move`, `grab.drop` and `grab.cancel` handlers, and the grab mode sink. The sink passes every key to the keymap and exists for `exit`, which every way out of the mode reaches, so a held drag always ends. The target hint of `;g` is run again through `hint.run` with the `every` filter, so any element can take the drop.
- `drag.ts`: the synthetic input, in three routes chosen by the source. A draggable element (or one inside it) gets DragEvents with a new `DataTransfer`, because mouse events never start a native drag. A range input gets a value plus `input` and `change`. Any other element gets pointer and mouse events. `release` and `abort` always send the closing events (`pointerup` and `mouseup`, or `drop` and `dragend`, or `change`). `abort` first moves back to where the drag began.

Limits: the events are not trusted, so a page that checks `isTrusted` ignores the drag. A drag stays inside one frame. A drag to another tab or app needs real input through the host and is not built. A page that calls `setPointerCapture` with the synthetic pointer fails in its own code, and the drag goes on.
