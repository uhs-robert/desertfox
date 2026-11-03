# handlers

The content-side code of each command that runs in the page. One file per command group, and each command is one `ContentHandler` object: a `run(args)` function and an optional `fill_from_page` map.

- `types.ts`: the `ContentHandler` type. `fill_from_page` names the params that the handler reads from the page when the invocation leaves them out.
- `scroll.ts`, `align.ts`: the `scroll.*` commands. `page.ts` holds `blur_focused_element` and remembers the last blurred field for `scroll.align`.
- `mode.ts`, `page.ts`, `stop.ts`, `focus.ts`, `copy.ts`: the mode, page and copy commands. `focus.ts` is a helper that has no handler object.
- `phase_2.ts`: handlers for commands whose code sits in a bundle (`hints`, `cmdline`, `caret`, `whichkey`). Each one asks `bundles` to load the bundle and run the command. If the bundle has no handler for the command yet, the handler refuses with a `NEEDS_*` message.

How a handler is found and called:

- `../handler_map.ts` maps a command id such as `scroll.lines` to its handler. It is the only id-to-code link in the content bundle.
- `../run_content.ts` looks the id up and throws if there is none. It fills each missing param named in `fill_from_page`, then calls `run` once per args set that the count rule gives. The content script shows a thrown error as a toast.
- The args are already checked, with defaults filled in, by the background compiler.

The definitions in `src/commands` import the same handler objects, so the count rule and `fill_from_page` live in one place.

To add a handler:

- Write the `ContentHandler` in the file of its group, or in a new file.
- Add it to `handler_map.ts` under the command id.
- Define the command in `src/commands` with the same object.
- To report a result, call `show_toast` from `../ui_proxy.ts`, as `copy.ts` does.
