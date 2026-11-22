# Keys and modes

Area: keys and modes.
READMEs: `src/shared/keys/README.md`, `src/content/README.md`, `src/content/handlers/README.md`.
Source: `src/shared/keys`, `src/content`, `src/content/handlers`.

## Keys and modes

The keymap is data, not code. It maps a mode and a key sequence to an invocation:

```json
{
  "normal": {
    "J": { "id": "tab.next" },
    "D": { "id": "tab.close", "args": { "side": "focus_previous" } },
    "sa": { "id": "open.search", "args": { "engine": "arch" } },
    "ca": { "id": "tab.reopen_in_container", "args": { "container": "Family" } }
  },
  "browser": {
    "<A-j>": { "id": "tab.next" },
    "<A-k>": { "id": "tab.prev" }
  }
}
```

- The extension ships a default keymap. The user config overrides it, as described in [Config](config.md#config).
- The background checks each entry against the registry when it loads. A bad entry logs a warning and is skipped, so one typo does not break the rest. The help page lists the warnings.
- Key notation is vim style: `<C-x>`, `<A-j>`, `<S-Escape>`. Sequences match through a prefix tree. A complete match runs at once, with no timeout.
### Modes and insert mode

- The modes are normal, insert, ignore, hint, cmdline, caret, visual, line visual, media and grab. See [Caret and visual](interfaces_caret_search_marks.md#caret-and-visual) and [Grab](interfaces_hints.md#grab). Insert mode follows `focusin` and `focusout` on editable elements. Each keydown and keyup also re-reads the focused element and follows a change in whether it takes typing, because a page can change that with no focus event. A key that finds no change leaves the mode alone, so Escape holds in a frame whose body is the editor and keeps the focus.
- The case that needs the re-read: the Google Sheets cell editor holds the focus all the time and counts as a field only while a cell is being edited (see [Firefox behavior](../firefox-behavior.md#the-google-sheets-cell-editor-sheets-cell-editor)). `i` enters insert mode with no field, in every frame of the tab, and a frame that loads later joins it.
- The background sends one message to the tab with no frame id and keeps only a flag for the hold, never a list of frames. A frame under an all-off site rule drops the message and stays in ignore mode, in both directions. Focus leaving a field does not end it. Escape in any frame returns all frames to normal, and so does a navigation. With no field focused, insert mode handles only Escape, so `<C-r>` and the other insert keys go to the browser.
- `gi` focuses the first field. A hidden input frame is a child frame of the page's own origin that the user cannot see: under 4 px on one side. Where the frame sits does not count, so an editor in a full-size frame that is scrolled out of view is not one. A page such as Google Docs types into one. While such a frame is in normal mode it blurs its own frame element, so the document that holds it gets the keys and every command, sink and panel works there.
- It hands off on each change into normal mode and when it gains the focus in normal mode, and no rule names a site. Escape hands off in the key's own turn. Every other hand-off waits one tick, so a focus move that leaves the frame for a field of the page is not cancelled. A mouse press that focuses the frame's field returns to insert mode, and so does `gi`, which picks a field in one of the page's hidden input frames ahead of the page's own visible fields.
- A frame that gains the focus again within 500 ms of a hand-off, with no insert mode between, keeps it, so a page that fights for the focus does not loop. While the page holds the focus, keys the page's editor handles in the frame (arrows and PageDown in Docs) do nothing.

### Layout fallback

- On a layout whose letters are not Latin (Cyrillic, Greek, Hebrew, Arabic and others), a plain letter whose typed character binds nothing acts as the Latin letter on its physical key (`event.code`). Shift gives upper case. A Latin letter outside ASCII, such as the Turkish `ı`, never swaps.
- A typed character that binds something never changes, so Latin layouts see no difference. A Ctrl, Alt or Meta chord has no fallback here: `token.ts` already maps it.
- A mode with a sink (hint mode) gets the typed letter and the physical one beside it. Label mode takes the typed letter when it continues a label, else the physical one, so Latin labels work on a Cyrillic layout. Text mode (after `/`) takes the typed letter only, so its filter keeps the typed text. With the setting off the sink gets no physical letter.
- The `layout_fallback` setting (default on) controls it. The compiled keymap carries `layout_fallback: false` only when off, and `key_flow` reads it on each install, so a config reload applies it.
- Only the content script applies it. A key typed before the keymap reply is held with its physical letter and replays under the rule. The command line page does not apply it: its default keymap binds no plain letter, and a letter typed in the line stays text.
- Letters only. No punctuation key was measured as needed.

### Leader and cancelled keys

- `,` is the built-in leader for DesertFox's own commands (`,r` reload, `h` help, `s` settings page, `t` toggle a setting, `i` ignore mode, `b` blur, `?` all keys, `"` registers). `<A-?>` lists the first keys in every mode except ignore and the command line (which keeps its own `<C-h>` help). In insert mode with no field focused the chord goes to the page. Space stays with the page, so pause on video sites and Space-to-scroll keep working. `,` alone runs nothing, because a key cannot be both a binding and a prefix.
- The which-key panel shows the group after the pause, and a key outside the group starts a new sequence, so `,G` scrolls to the bottom. A lone `,` in normal mode no longer reaches the page. `pass = ","` in a site rule gives it back on one site, and `<C-v>,` passes one comma. DesertFox reserves no user leader: `\` and `<Space>` are unbound by default, and a user who binds Space as a leader loses Space on the page.
- In every mode except insert, ignore, hint and cmdline, DesertFox cancels a `/` or `'` keydown that no binding takes, when focus is not in a field. Shift does not matter, but Ctrl, Alt or Meta do. Firefox starts Quick Find on these keys in page content (see [Firefox behavior](../firefox-behavior.md#firefox-defaults-not-measured)), and Quick Find competes with DesertFox's own [page search](interfaces_caret_search_marks.md#page-search). Insert and ignore mode give keys to the page, and hint and cmdline mode own theirs. Every other mode is covered, so a new mode is covered without a change.
- In caret, visual and line visual mode, DesertFox also cancels every other unbound key without Ctrl, Alt or Meta, outside fields. These are reading modes, and a site shortcut (a letter in a mail app, a digit in a video player) moves the user away from the caret. Tab and Shift+Tab, the function keys, Escape, Page Up, Page Down, Home and End still reach the page. So focus moves, Firefox's own keys work, a page dialog closes and the page scrolls. Space and Backspace stay blocked. Every chord passes too, so Ctrl+C copies a selection. Normal mode passes unbound keys, apart from `/` and `'`.
### Key editor capture

- The Keys section of the settings page edits one binding in a row editor: a capture box, a command field and a live check. The capture box is a focusable `div`, not a text field, so insert mode and the IME stay out. One window `keydown` listener in the capture phase takes the keys. `main.ts` registers it before `content.js` and the drawer's Escape handler load, so it runs first and stops the event. It acts only while the box holds focus: the box binds on focus and unbinds on blur, on a route change and on removal from the page. No other listener is added.
- Opening an editor moves the focus into the capture box. On an existing row the box shows the row's keys, and the first press replaces them. Escape cancels the capture and puts the row's keys back. Backspace drops the last key. A Clear button empties the sequence. Tab and Shift+Tab move the focus as usual, so the box never traps the keyboard. Enter saves. A modifier on its own is ignored. Saving an existing row on other keys moves it: one `change_keymap` set with `move_from` frees the old key (an empty text for a file or default binding, a dropped edit for a key only an edit binds) and binds the new one, in one change with one rollback. A row with several steps keeps its keys. Firefox keeps some chords for itself (Ctrl+T, Ctrl+W, Ctrl+N, F5) and the page never sees them. Escape, Backspace, Tab and Enter cannot be bound from the box, so the page tells the user to use the config files.
- A row with several steps shows its steps joined by ` ; ` and is read-only, because the check refuses that text. Its Remove and Reset still work. The command field offers the command line names, the aliases and the installed snippets in a native `datalist`. The check, 250 ms after the last change, is the real validator.

### Badge, toast and which-key panel

- A mode badge sits in the bottom right corner, 8 px above the bottom edge. The `mode_indicator` setting controls it: `always` (the default), `not_normal` or `off`. The `theme` setting names a theme (default `oasis_moonlight`), see [Themes](config.md#themes). Light or dark follows Firefox, and Firefox's Settings > General > Website appearance (Automatic, Light or Dark) switches it.
- A toast is one short message in the bottom right corner, framed in the color of its kind (error, warning, info or success). It disappears after `toast_error_ms` (default 6000) for an error and `toast_ms` (default 3000) for every other kind, whole milliseconds from 500 to 30000. The compiled keymap carries both values, as it does `which_key_delay_ms`, and the content script hands the one that fits the kind to the `ui` bundle with each toast.
- The which-key panel is a floating frame with a 1 px tinted border and its title set into the top border. The `which_key_border` setting picks the corners: `square` (the default), `round` or `chamfer`. The `which_key_skip` setting lists key prefixes, in keymap notation, whose panel does not open after the delay (exact match, global, checked with the key parser). An instant redraw still shows it: Backspace back to the prefix, or a key typed while a panel is already up. `?` lists only the first keys of the mode. A footer names the exit keys. Below them a `.` line shows the step `.` would repeat, as the command line that does the same (a command with no name shows its label), while the panel is open. A saved count shows too: a count that maps to an argument shows as that argument, and a repeat count, which the command line cannot spell, shows as a prefix such as `5× :scroll`. A label has no argument, so a command with no name shows either kind of count as that prefix. The `which_key_repeat` setting (default on) turns it off. The panel bundle asks the background with `read_repeat_preview` and the background reads the normal slot of the repeat memory only, so a private tab gets no line.
### Bridge and browser mode

- The `bridge` setting (default off) opens the native bridge, and `bridge_share_tabs` (default off, needs `bridge`) lets it list, activate, close and capture tabs, see [Bridge host](host.md#bridge-host). Neither changes the badge or the which-key panel: both stay in the page.
- `browser` mode holds the chords for the Firefox shortcuts. The manifest reserves a fixed number of shortcut slots, and the background assigns the chords to them with `commands.update`. A chord keeps its slot: `desertfox_slot_map` (chord to slot) is stored, a new chord takes the first free slot, a removed chord frees its slot and no later chord shifts. The first run seeds the map from the keymap order the slots had before, so no chord moves. A chord past the last free slot is refused at save and skipped with a warning at publish. The map is read and written inside the publish, in the change queue, and a failed change puts it back with the edit layers. The content script also catches these chords. If it cancels a chord, Firefox does not fire the shortcut as well, which the key test showed (see [firefox-behavior.md](../firefox-behavior.md), "Phase 1 measurements").
