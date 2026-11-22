# copy

- `strip_tracking.ts`: drops the `strip_tracking_params` names from a web address. The page and hints bundles and `commands/copy_tabs.ts` use it.
- `link_list.ts`: the lines of a copied link list in four formats and `is_web_address`. `hints/yank_links.ts` and `commands/copy_tabs.ts` share it.
- `link_escape.ts`: the bracket escaping that `link_list.ts` and the page copy handler use.
- `copy_text.ts`: the clipboard write, and `copy_yank`, the yank path of the caret, hints and page bundles: the clipboard, then `register_yank` for the unnamed and named register.
