# hints

The `hints` bundle (`hints.js`). The background injects it into a frame on the first `hint.run` or the first entry into `hint` mode.

- `main.ts`: registers the `hint` sink and the `hint.run` handler: finds candidates, draws labels, runs the pick, and owns the keyboard of a `--all-frames` run.
- `prompt_line.ts`: the `prompt` action (`;:`): opens the command line with the pick's address, quoted (`quote_for_line`).
- `collect_copy.ts`: rapid `copy` and `copy_text`: `collect_pick` keeps the session's list of copied texts.
- `pick.ts`: the typing rules, label mode and text mode (`/`). Pure. The label generator is `src/shared/hints/labels.ts`.
- `rank.ts`: the text ranking of text mode (`score_text`, `rank_items`). Pure.
- `inspect.ts`: the `inspect` action (`;o`): `hand_to_devtools` exposes the pick to the devtools page. `main.ts` wires its send to the `inspect_pick` message.
- `view.ts`: the labels in a closed shadow root, the key line, and the Tab rotation of overlapping labels.
- `focus_fields.ts`: the pick of `page.focus_field` (`]i`, `[i`) and `page.focus_link` (`]l`, `[l`).
- `click_first.ts`: the `page.click` handler: clicks the first shown match of a selector with the hint click. Pure.
- `yank_links.ts`: the list of `copy.links` (`yL`, `yl`, `:copylinks`), formatted through `src/shared/copy/link_list.ts`.
- `insert_text.ts`: types the keys a pick queued into the field it focused, through `../lib/field_writer.ts`.
- Hints across frames (`--all-frames`, in `main.ts`): the keyboard frame owns the picker, and the labels come from `src/background/hint_frames.ts`.

- Grab picks (`;g`, `;G`, `;s`): `start_mode_` in `main.ts` hands the pick to the `grab` bundle (`../grab/`), as it hands a caret pick to `caret.js`.

The detail of the entries above is in "Hints files for the hints bundle" in `docs/design/interfaces_hints.md`.

The registry never imports this folder. The command and its params sit in `src/commands/hint.ts`.
