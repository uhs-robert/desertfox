# site

The site table's pure views. Each file takes rows or a compiled keymap and returns data, with no storage or browser call, so the help page, the popup and the background share them.

- `site_columns.ts`: the page's columns of the site table and the normal tree under them (`site_columns_for`, `normal_tree_for`, `graft_binds`). The background's `page_keymap.ts` and `list_keys.ts` read it.
- `site_rules_view.ts`: what the site table does to one address, for the help page's Site Rules view.
- `site_keys.ts`: the `{ site, pass }` rows of the Settings form for the keys a site keeps. `background/site_keys.ts` answers the request.
- `site_state.ts`: the popup's site pattern and state, and the row changes of Disable on this site (`site_pattern`, `site_state`, `site_rows_after`).
