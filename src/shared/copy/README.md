# copy

- `strip_tracking.ts`: drops the `strip_tracking_params` names from a web address. The page and hints bundles and `commands/copy_tabs.ts` use it.
- `link_list.ts`: the lines of a copied link list in four formats, `is_web_address` and `dedupe_links`, the strip, dedupe and cap of a link list. `hints/yank_links.ts`, `commands/copy.ts` and `commands/copy_tabs.ts` share it.
- `page_link.ts`: the text of a yanked page link in six formats. The page bundle and `copy.page` share it.
- `link_escape.ts`: the bracket escaping that `link_list.ts` and the page copy handler use.
- `copy_text.ts`: the clipboard write, and `copy_yank`, the yank path of the caret, hints and page bundles: the clipboard, then `register_yank` for the unnamed and named register.
