# hints

The `hints` bundle (`hints.js`). The background injects it into a frame on the first `hint.run` or the first entry into `hint` mode.

- `main.ts`: registers the `hint` sink and the `hint.run` handler: finds candidates, draws labels, runs the pick, and owns the keyboard of a `--all-frames` run.
- `prompt_line.ts`: the `prompt` action (`;:`): opens the command line with the pick's address, quoted (`quote_for_line`).
- `collect_copy.ts`: rapid `copy` and `copy_text`: `collect_pick` keeps the session's list of copied texts.
- `candidates.ts`: one query per `HintFilter` (`query_for`) that finds the elements to label, the weak-candidate rule and `with_site_selectors` for `hint_add` and `hint_remove`.
- `visible.ts`: keeps what a person can click (inside every scrolling box, not hidden, not covered), reading the page only through `PageProbe`.
- `drop_targets.ts`: the `drop` filter of the grab target pass: `drop_targets_of(source)` gives the elements a drop can likely land on.
- `selector_of.ts`: the shortest unique CSS selector of an element for `copy_selector`. Pure. Skips ids and classes that look generated.
- `pick.ts`, `rank.ts`: the typing rules (label mode, and text mode on `/`) and the text ranking. The label generator is `shared/hints/labels.ts`. Pure.
- `inspect.ts`: the `inspect` action (`;o`): hands the picked element to the devtools page (`hand_to_devtools`, message `inspect_pick`).
- `actions.ts`: what a picked element gets: click, focus, open, the copy and download actions, delete, hover, double click, media actions, and the hand-off to `caret` and `grab`.
- `view.ts`: the labels in a closed shadow root, the key line, and the Space rotation of overlapping labels.
- `heading_match.ts`: which elements count as headings (`HEADINGS`, `is_heading`, `rendered_text`). A leaf, so `candidates.ts` and `headings.ts` share it.
- `headings.ts`: the page's headings for the `heading` command and the `page.heading` jumps (`]h`, `[h`, `]H`, `[H`, `}`, `{`).
- `focus_fields.ts`: the pick of `page.focus_field` (`]i`, `[i`) and `page.focus_link` (`]l`, `[l`).
- `click_first.ts`: the `page.click` handler: clicks the first shown match of a selector with the hint click. Pure.
- `yank_links.ts`: the list of `copy.links` (`yL`, `yl`, `:copylinks`), formatted through `../link_list.ts`.
- `insert_text.ts`: types the keys a pick queued into the field it focused, through `../text/field_writer.ts`.
- Hints across frames (`--all-frames`, in `main.ts`): the keyboard frame owns the picker, and the labels come from `src/background/hint_frames.ts`.
- `hover.ts`: the one hovered element, moved like a real pointer. It outlives the hint session, which ends at the pick.
- `follow.ts`: repositions the labels on the next animation frame after a scroll or resize in the top window or a frame window.

- Grab picks (`;g`, `;G`, `;s`): `start_mode_` in `main.ts` hands the pick to the `grab` bundle (`../grab/`), as it hands a caret pick to `caret.js`.

The detail of the entries above is in "Hints files for the hints bundle" in `docs/design/interfaces_hints.md`.

The registry never imports this folder. The command and its params sit in `src/commands/hint.ts`.
