# hints

The behavior is in [`docs/design/interfaces_hints.md`](../../../docs/design/interfaces_hints.md).

- `labels.ts`: the prefix-free hint label generator, the typing rules and the overlap and rotate helpers. The hints bundle and `background/hint_frames.ts` use it.
- `pick.ts`: the typing rules, label mode and text mode (`/`). Pure. The hints bundle runs it on a page, and `background/chrome_hints.ts` replays a module session's keys into it.
- `rank.ts`: the text ranking of text mode (`score_text`, `rank_items`). Pure.
- `hint_keys.ts`: which keys hint mode takes itself. `content/key_flow.ts` and `pick.ts` read it.
