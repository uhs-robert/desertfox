# grab

The `grab` bundle (`grab.js`): keyboard drag, move and swipe of a hinted element. Behavior is in `docs/design/interfaces_hints.md`, section "Grab files for keyboard drag".

- `main.ts`: the `grab.mode`, `grab.move`, `grab.step`, `grab.drop` and `grab.cancel` handlers and the grab mode sink.
- `drag.ts`: the synthetic input of a drag, a slider move and a swipe fling.

Rules across files:

- The hints bundle picks the element and leaves it in `desertfox_pick_target`. The target pick runs again through `hint.run` (`src/content/lib/drop_targets.ts`).
- The events are not trusted, so a page that checks `isTrusted` ignores the drag.
