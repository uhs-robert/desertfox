# popup

The toolbar popup (`default_popup`). It is a page of its own, so a click on the button never reaches `browserAction.onClicked`.

- `model.ts`: the rows, from plain inputs. No DOM, so tests read them. Row order: the on/off switch, Settings, Help, Disable on this site, the rule row, Reload config, the warnings count, the version. The site row is grey while off, with "a rule covers it" when another row decides the page's `off` column, and with no site on a page that is not http or https. The rule row shows what the matching rows set ("all off", "pass 3 keys", "only 2 keys", "on, pass 1 key") and links to the settings page. Rule edits reach open tabs at once, so the popup offers no tab reload. Reload config is grey without the native host.
- The site row saves a whole `site_rules` list that starts as the file's list, with an `off = true` row appended. Later file edits to `site_rules` do not apply until `:unset site_rules` clears it.
- `main.ts`: reads storage and the active tab when it opens, draws the rows and sends the writes to the background (`toolbar_set_disabled`, `toolbar_site`, `toolbar_reload_config`). It writes nothing itself. Settings, Help and Warnings open the help page through `plan_help_tab`. The popup themes like the help page and stays themed while off.
- `popup.html`: the page and its styles.
