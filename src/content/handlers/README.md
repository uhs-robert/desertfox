# handlers

The content-side code of each command that runs in the page. One file per command group, and each command is one `ContentHandler` object: a `run(args)` function and an optional `fill_from_page` map. `run` returns nothing for done, throws for failed, or returns an `Outcome` or a promise of one. A command that hands control to the user (`hint.run`, `cmdline.open`, `find.open`) stays pending until the user finishes: a pick or Enter is done, and Escape, an unrelated key or a page change is cancelled. A failed command returns its message and does not toast it, so the caller shows it once.

- `types.ts`: the `ContentHandler` type. `fill_from_page` names the params that the handler reads from the page when the invocation leaves them out.
- `scroll.ts`, `align.ts`: the `scroll.*` commands.
- `page.ts`: the page focus commands. It also holds `blur_focused_element` and remembers the last blurred field for `scroll.align`.
- `mode.ts`, `stop.ts`, `copy.ts`: the mode, stop and copy commands.
- `focus.ts`: a helper that has no handler object.

How a handler is found and called:

- `../handler_map.ts` maps a command id such as `scroll.lines` to its handler. It is the only id-to-code link in the content bundle.
- `../run_content.ts` looks the id up. An id with no handler but with a `bundle` on the invocation runs through the bundle host, which loads the bundle first. Any other id fails. It fills each missing param named in `fill_from_page`, then calls `run` once per args set that the count rule gives. A thrown error also becomes a failed outcome, which the caller shows as a toast.
- The args are already checked, with defaults filled in, by the background compiler.

The definitions in `src/commands` import the same handler objects, so the count rule and `fill_from_page` live in one place.

To add a handler:

- Write the `ContentHandler` in the file of its group, or in a new file.
- Add it to `handler_map.ts` under the command id.
- Define the command in `src/commands` with the same object.
- To report a success, call `show_toast` from `../ui_proxy.ts`, as `copy.ts` does. To report a failure, return it as an `Outcome`.
