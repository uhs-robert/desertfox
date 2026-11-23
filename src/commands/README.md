# commands

The command definitions. Each file is a command module: it calls `define` from `src/shared/registry/` once per command and holds the code that runs it. Keys, the command line, completion,
help and which-key read the definition and never carry behavior of their own.

This folder and `src/background/` import each other. `src/background/command_modules.ts` imports every command module for its side effect. A command may call background helpers. The
background takes only the wiring calls in `main.ts` from here. The pure plan and URL helpers live in `src/shared/` (`settings_plan.ts`, `url_build.ts`). A command module may use a background
value while it loads (11 do: three by calling, `media.ts`, `help.ts` and `session.ts`, and the rest by reading exports) only when that background module does not reach back to that command
module, directly or through `availability.ts`.

The rules for a definition and the notes per module are in "Commands files for the registry" in `docs/design/registry.md`.

- `bookmark.ts`: the `bookmark.*` commands: add, open, remove, rename, edit_url, move and open_folder.
- `browser.ts`: `browser.focus_page`, `frame.exit` and `browser.close_all`.
- `caret.ts`: `caret.move` and `caret.find`. The code sits in a bundle.
- `cmdline.ts`: the `cmdline.*` commands, `list.act` and `list.select`. The code sits in the `cmdline` bundle.
- `command.ts`: `command.repeat`, which replays the stored request through a router that `main.ts` wires in.
- `config.ts`: `config.reload` and `debug.restart`.
- `copy.ts`: `copy.url` and `copy.links`.
- `copy_tabs.ts`: `copy.tabs` (`yT`), which lists the open web tabs in the link-list formats.
- `engine.ts`: `engine.show`.
- `find.ts`: `find.open`, `find.next` and `find.prev`, the page text search. The code sits in the `caret` bundle.
- `firefox_page.ts`: the handler and page table of `browser.open_firefox_page`: it asks the native host to open an `about:` page.
- `grab.ts`: the keys of grab mode (`grab.move`, `grab.step`, `grab.drop`, `grab.cancel`). The `grab` bundle runs them.
- `heading.ts`: `heading.go`. The code sits in a bundle.
- `help.ts`: `help.open`, `help.key` and `help.whichkey`. It builds the `:help` choices from the registry, so `command_modules.ts` imports it last.
- `help_tab.ts`: `open_help_url`, which opens a help page URL beside the asking tab or navigates in place. Shared by the help and native commands.
- `hint.ts`: `hint.run`. The code sits in the `hints` bundle.
- `hint_text.ts`: `hint.key`, the binding that holds Tab, Enter, Space and Slash while the hints bundle loads.
- `history.ts`: `history.open`.
- `issue.ts`: `help.issue` (`:issue`): opens the prefilled GitHub new-issue form, or with `--copy` copies the report.
- `jump.ts`: `page.jump` (`<C-o>`, `<C-i>`), in the `page` bundle.
- `macro.ts`: `macro.record`, `macro.stop` and `macro.play`, over the recorder and replay in `src/background/`.
- `mark.ts`: `mark.add`, `mark.jump` and `mark.step`, in the `page` bundle.
- `mark_list.ts`: `mark.list`, `mark.delete` and `mark.clear`. Typing the command is the confirmation, and `.` never replays `all`.
- `media.ts`: `media.act` (`media`), which runs the frame fan-out in `src/background/media_actions.ts`.
- `mode.ts`: the mode commands (`mode.set`, `mode.site`, `mode.insert`, `mode.escape`, `mode.pass_next`) and `page.focus_input` and `page.blur`.
- `native.ts`: `native.install`, `native.update`, `permissions.grant` and `browser.open_firefox_page`.
- `open.ts`: `open.url`, `open.search`, `open.clipboard` and `open.anything`.
- `open_target.ts`: the `where` and `container` params, `open_in`, the container lookup and `typed_url_target` for typed text.
- `page.ts`: the page commands: back, forward, reload, print, save_pdf, stop, home, follow, `page.focus_field`, `page.focus_link`, `page.heading` and `page.send_key`.
- `perf.ts`: `debug.perf` (`:perf`), which copies the timing summary to the clipboard.
- `quickmark.ts`: the `quickmark.*` commands: add, open, delete and list, over a `QuickmarkDeps` object.
- `register.ts`: `register.list` (`:registers`).
- `register_param.ts`: the `register` param that the yank commands and `open.clipboard` share.
- `reload_clear.ts`: the clear scopes of `reload --clear` (`site` and `all`). A site clear takes only the cookies by host name.
- `scroll.ts`: the `scroll.*` commands: lines, pixels, pages, to and align.
- `session.ts`: `session.save`, `session.open`, `session.delete` and `session.rename`, over a `SessionDeps` object.
- `settings.ts`: `set`, `toggle` and `unset` (ids `settings.set`, `settings.toggle`, `settings.unset`), over the planners in `src/shared/settings_plan.ts`.
- `tab.ts`: the `tab.*` commands: next, prev, undo_close, move, duplicate, detach, goto, alternate, pin, mute and more.
- `tab_group.ts`: the `tabgroup.*` commands on the tab's native tab group, over `TabGroupDeps`.
- `tab_split.ts`: `tab.split_other` and `tab.split_swap`, over `src/background/tab_split.ts`.
- `text.ts`: `text.insert`, `register.paste` and `text.edit_external`. The code sits in the `text` and `editor` bundles.
- `url.ts`: `url.parent`, `url.root` and `url.increment`.
- `visual.ts`: `visual.act`, `visual.object` and `visual.open`. The code sits in a bundle.
- `window.ts`: `window.new`, `window.close`, `window.undo_close` and `tab.attach`.
- `zoom.ts`: `zoom.by` and `zoom.set`.

To add a command: pick the module of its group, or add one. Call `define` with the id, label, intent and params. Import the module in `src/background/command_modules.ts`, which the
commands.json build tool reads too. Put browser access in `run` and keep URL math in a pure function with a test. A command that only opens a URL is better as an engine in the user's config,
and one that needs the page DOM or several steps as a snippet.
