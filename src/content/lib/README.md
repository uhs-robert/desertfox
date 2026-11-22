# lib

Code that more than one bundle, or `content.js` and a bundle, needs. The import rule is in `../README.md`.

- `hint_keys.ts`: which keys hint mode takes itself. `key_flow.ts` and the `hints` bundle read it.
- `field_text.ts`: `read_field_text`, what a field holds now. `content.js`, `text` and `editor` read it.
- `page_reader.ts`: `PageReader`, the read of a page that the `]]` detector, the load step and the item finder share, and the walks over it (`ancestors`, `in_carousel`).
- `groups.ts`: the repeated blocks of a page (`list_groups`, `main_list`). The item finder and the `]]` load step read them, so both agree on the main list.
- `dom_reader.ts`: the `PageReader` over real elements, for the item finder and the `]]` detector.
- `item_types.ts`: the item finder's `Region` and the `page.item` args and cursor types, which `bundle_calls.ts` and `next_page` read.
