# popup

The toolbar popup (`default_popup`). It is a page of its own, so a click on the button never reaches `browserAction.onClicked`.

Behavior is in `docs/design/interfaces_pages.md`, section "Popup files for the toolbar popup".

- `model.ts`: the rows and the small models (release link, theme list, host dot, notice timer), from plain inputs. No DOM.
- `main.ts`: reads storage and the active tab, draws the popup and sends the writes to the background. It writes nothing itself.
- `popup.html`: the page and its styles.

Rules across files:

- `model.ts` imports no DOM, so tests read the rows.
- The popup themes like the help page and stays themed while off.
