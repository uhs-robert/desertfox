# help

The help page, opened by `help.open`. It reads `commands.json`, the compiled keymap, the stored warnings and the resolved engines.

The detail of the long entries is in "Help files for the help page" in `docs/design/interfaces_pages.md`.

- `../shared/page/help_route.ts`: the pages and the hash parser: `#/<page>`, `#section=`, `#command=`, `#engine=`, `?advanced`, `?address=`. An unknown hash shows Home.
- `practice_page.ts`: the Practice page (`#/practice`): short lessons in order, each with check lines that turn to "Done".
- `practice_lessons.ts`: the text of the lessons, in page order, and the fastest key for each task.
- `quick_start.ts`: the Quick Start text as blocks. A `{name}` in a sentence is looked up in the compiled keymap by command and args.
- `model.ts`: turns the help inputs (commands.json, the keymap, the warnings, the engines) into plain rows, so tests need no DOM. Holds `STYLE_VARIABLES` and `STYLE_CLASSES`.
- `config_view.ts`: turns the config status into the config source line and the apply steps of the Settings Advanced block. No DOM.
- `settings_model.ts`: no DOM. Picks the control per setting kind, checks typed values, and holds the session with a draft per field.
- `site_keys_model.ts`: no DOM: the state of the "Let this site keep some keys" form (site, key chips, pick list). Sends `site_keys`.
- `site_keys_page.ts`: draws that form, with a capture box from `create_key_capture` in `keys_page.ts`.
- `settings_page.ts`: draws the fields of Settings and wires events to the session. Text fields check as you type and save when left.
- `site_rule_effect.ts`: what a stored site rule does, in plain words, for the site rules table of Settings (`site_rule_effects`). No DOM.
- `keys_model.ts`: no DOM: the Keys section's binding list, filter, one open row editor, and the check, save, remove and reset calls.
- `keys_page.ts`: draws the Keys section, one table per mode, and holds `create_key_capture`, the window keydown listener.
- `engines_model.ts`: no DOM: the state of the Search engines section: the engines the page added, the add form and its local check.
- `engines_page.ts`: draws the Search engines section of Settings.
- `pairs_model.ts`: no DOM: the state of the Aliases and Quickmarks sections, one model for both (a `PairsKind` names the messages and labels).
- `pairs_page.ts`: draws the Aliases and Quickmarks sections.
- `themes_model.ts`: no DOM: the state of the "Import a theme" box. Parses the scheme as you type, suggests a name, sends a save or a remove.
- `themes_page.ts`: draws the "Import a theme" box with its live preview and the list of theme files.
- `settings_page.ts` draws `newtab_links` as a list of rows (label, address, group) in the New tab group (`link_list` control), saved as a whole list.
- `transfer_model.ts`: no DOM: the state of the "Advanced: back up and restore" section: the picked import, the preview, the ticked snippets and the export zips.
- `transfer_page.ts`: draws that section: export buttons, the pickers, the consent screen and the installed snippets with Remove.
- `host_start_model.ts`: no DOM: the state of the banner for a pending host start. Sends the user's answer with the digests it showed.
- `host_start_page.ts`: draws that banner at the top of Settings.
- `files_model.ts`: no DOM: the state of the "Advanced: edit files" section: the stored files, the open text and each save sent to the background.
- `files_page.ts`: draws the files editor: the file list, a text box, every build problem and the snippet consent card.
- `file_templates.ts`: the commented text a new file starts with (`template_for`).
- `blocks.ts`: the block list type that the docs renderer writes and the help page draws, including `tip`.
- `dom.ts`: the DOM toolkit the pages share (`el`, `block_node`, `page_link`, `table_of`). It imports no page.
- `sections.ts`: the section model: `page_sections`, the Settings section titles and the anchors. It imports no renderer.
- `sidebar.ts`: the sidebar and the narrow-window drawer, the "you are here" mark and the support card.
- `render.ts`: `render_help` (page frame, sidebar, drawer bar) and `page_body` (picks the page renderer). No page content.
- One renderer per page, drawn with DOM calls only. Command text never goes through `innerHTML`.
- `home_view.ts`: Home and the keycap above its title.
- `quick_start_view.ts`: the Quick Start blocks, with ids on the level-2 headings.
- `practice_page.ts`: Practice.
- `commands_view.ts`: the Commands page: a card per command, the params table, the advanced toggle and `command_anchor`.
- `search_engines_view.ts`: the Search Engines page: the guide headings and "Your engines" (the engine table and `engine_anchor`).
- `styling_view.ts`: the Styling page, from `STYLE_VARIABLES` and `STYLE_CLASSES`.
- `settings_view.ts`: the Settings page frame: the group sections, the Advanced block and `update_config_source`. The form pages fill its boxes.
- `settings_boxes.ts`: the table of Settings boxes in mount order: class, mount, optional user CSS hold. `main.ts` stops and mounts through it. Open it to add a box.
- `site_rules_list_view.ts`: the Site Rules page.
- `user_css_gate.ts`: `create_user_css_gate` keeps the user CSS sheet off the page while a review, consent card or the grant panel shows.
- `grant_panel.ts`: the panel that `:permissions.grant <permission>` and `:native.install` open (`#grant/<permission>?<nonce>`). It sits outside the body.
- `main.ts`: loads the inputs, renders the route in the hash and draws again on `hashchange` and on a settings change (`follow_settings`). It mounts the Settings boxes through `settings_boxes.ts`.
- `home.html`: the page and its styles. It links `page_base.css` first and loads `content.js` by script tag. Other bundles load on first use.
- The sidebar ends with a support card linking GitHub Sponsors and Ko-fi (`support_card` in `sidebar.ts`).
- Narrow window (40rem or less): the sidebar is a drawer, built by `render_help` and `wire_drawer` and styled in `home.html`.

`STYLE_VARIABLES` and `STYLE_CLASSES` in `model.ts` list the public styling surface. Add a surface's class names there when it ships.

Look: the page styles read only `var(--desertfox-*)` variables, with fallbacks in `page_base.css`. The Styling page lists them.
