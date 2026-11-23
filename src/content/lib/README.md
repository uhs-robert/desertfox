# lib

Code that more than one bundle, or `content.js` and a bundle, needs. The import rule is in `../README.md`.

- `hint_keys.ts`: which keys hint mode takes itself. `key_flow.ts` and the `hints` bundle read it.
- `field_text.ts`: `read_field_text`, what a field holds now. `content.js`, `text` and `editor` read it.
- `page_reader.ts`: `PageReader`, the read of a page that the `]]` detector, the load step and the item finder share, and the walks over it (`ancestors`, `in_carousel`).
- `groups.ts`: the repeated blocks of a page (`list_groups`, `main_list`). The item finder and the `]]` load step read them, so both agree on the main list.
- `dom_reader.ts`: the `PageReader` over real elements, for the item finder and the `]]` detector.
- `item_types.ts`: the item finder's `Region` and the `page.item` args and cursor types, which `bundle_calls.ts` and `next_page` read.
- `actions.ts`: what a picked element gets (`click_like_a_hint`, focus, open, copy, download and the rest). The `hints`, `item_act`, `tree` and `next_page` bundles read it.
- `candidates.ts`: the query and filters that find the elements to label. The `hints` bundle and the `]]` link finder read them.
- `visible.ts`: keeps what a person can click, reading the page through `PageProbe`.
- `drop_targets.ts`: `drop_targets_of`, the elements a drop can likely land on, for the `hints` and `grab` bundles.
- `selector_of.ts`: the shortest unique CSS selector of an element.
- `heading_match.ts`: which elements count as headings (`is_heading`, `rendered_text`). A leaf under `candidates.ts` and `headings.ts`.
- `headings.ts`: the page's headings for the `heading` command and the `page.heading` jumps, and for `]]`.
- `hover.ts`: the one hovered element, moved like a real pointer. It outlives the hint session.
- `follow.ts`: repositions an overlay on the next animation frame after a scroll or resize. The `hints` labels and the `item` box read it.
- `leave_watch.ts`: the jump list's watch of the page being left, armed once per document by the `page`, `hints` or `next_page` bundle.
- `clipboard.ts`: the clipboard handler code of `site_actions` and the `editor` copy path.
- `send_key.ts`: the `page.send_key` code and its queue of key pairs, for `site_actions` and `editor`.
- `entry.ts`: the entry command mark that a focused field carries to its first session.
- `field_writer.ts`: `write_into_field`, the one writer of text into a field.
- `host_editable.ts`: `is_editable_in_frame`, the field check.
- `secret_field.ts`: `is_secret_field`, the one test for a field whose text is never recorded.
