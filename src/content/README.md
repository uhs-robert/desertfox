# content

The content script. It runs at `document_start` in the top frame and in same-origin frames.

- `main.ts`: the capture listener, the storage read, messages and mode wiring. Not unit tested, it needs a DOM.
- `key_flow.ts`: decides per key token whether the page keeps the key, holds keys until the keymap is read, replays them. Pure.
- `mode_state.ts`, `page_mode.ts`: the modes and the pass-next flag. `page_mode` is the one shared instance.
- `plan_steps.ts`, `invocation_args.ts`: split a leaf into ordered runs and apply a command's count rule. Pure.
- `scroll_target.ts`, `match_pattern.ts`, `editable.ts`: pure helpers for scroll choice, `ignore_sites` and focus.
- `handlers/`: one plain function per content command. `handler_map.ts` is the only id-to-code link. The definitions in `src/commands` import the same handler objects, so the count rule lives in one place.
- `toast.ts`: the message surface for refusals.

The key test reads `data-oasisfox-tree-read-ms` and `data-oasisfox-tree-ready-at-ms` on the document element.
