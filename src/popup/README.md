# popup

The toolbar popup (`default_popup`). It is a page of its own, so a click on the button never reaches `browserAction.onClicked`.

- `model.ts`: the rows, from plain inputs. No DOM, so tests read them. Row order: the on/off switch, Settings, Help, Disable on this site, Reload config, the warnings count, the version. The site row is grey while off, with "set in config" when the config file already matches, and with no site on a page that is not http or https. Reload config is grey without the native host.
- `main.ts`: reads storage and the active tab when it opens, draws the rows and sends the writes to the background (`toolbar_set_disabled`, `toolbar_site`, `toolbar_reload_config`). It writes nothing itself. Settings, Help and Warnings open the help page through `plan_help_tab`. The popup themes like the help page and stays themed while off.
- `popup.html`: the page and its styles.
