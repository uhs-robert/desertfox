# Phase 0 spike

The spike answered three questions before design work: where plain keys and Firefox shortcuts work, how soon a key listener is ready on a loading page, and what messages cost. The code is in `spike/`. It is throwaway.

## Setup

- Firefox 159 with a throwaway profile, inside the Oasis shadow (a nested, invisible Hyprland). `wtype` sent real key presses.
- A temporary add-on, installed over Firefox's remote debugging protocol (`spike/rdp_install.mjs`). It catches `Shift+J/K` in a `document_start` content script and has `Alt+J/K` as Firefox shortcuts.
- A local server (`spike/server.mjs`) serves pages with slow headers, a slow body, a page that cancels every key in its own capture listener, a long article for reader view and a PDF.
- A native host (`spike/host/`) logs every event and echoes for the latency test.

## Results

| Page | `Shift+J` (content script) | `Alt+J` (Firefox shortcut) |
| --- | --- | --- |
| http page, about:blank | works | works |
| about:addons, about:preferences, about:support | lost | works |
| view-source, reader view, PDF viewer | lost | works |
| addons.mozilla.org | lost | works |
| New tab page, or address bar focused | lost | works |
| Page that cancels keys in its own capture listener | works | lost |

- The content script listener is ready 11-58 ms after the first byte of the response, with a median of 27 ms (24 fresh loads).
- While Firefox navigates away from a live page, the old page keeps catching keys until the new one commits. A new tab with no committed page catches nothing.
- After `J` switches to a tab that Firefox unloaded, a second `J` within about 120 ms is lost. At 200 ms it is caught. The test server answers in a few ms, so on a real site add the server's response time.
- Round trips from the content script to the background, and from the background to the native host over an open port, have a median under 1 ms and a p95 of 1 ms (300 samples each).

## What it means

- Plain `J/K` in a content script covers web pages, including pages that load and pages that cancel keys.
- `Alt+J/K` as Firefox shortcuts cover every page without a content script.
- The content script also catches the chords, so a page that cancels keys cannot block them where the content script runs.
- Firefox adds no startup delay of its own. A slow key listener comes from what the extension loads before it listens.

## Managed storage

A second test checked whether Firefox reads `~/.mozilla/managed-storage/<extension id>.json` again after an edit. The extension read `browser.storage.managed` every second.

- Edits made while the extension ran were not visible, 12 s later or ever. Firefox sent no `storage.onChanged` event.
- After the extension reloaded, it read the current file within about 1 s.
- So the file is read once per extension load. A reload applies an edit. A Firefox restart is not needed.

## Phase 1 measurements

`just key-test` (`test/key/`) ran the built extension as a temporary add-on in the same kind of nested session, with a managed storage config written before the install. Test pages report to a local server. Two measurements came out of that run, and two behaviors.

- The content script reads the compiled keymap from `storage.local` and sets `data-oasisfox-tree-read-ms` on the document element. Over 24 fresh loads the read took a minimum of 6 ms, a median of 8 ms and a maximum of 10 ms, counted from the start of the content script. Firefox rounds these times to whole milliseconds.
- After `config.reload`, Firefox loaded the content script again into every open `http` tab. The background stored `already_loaded: 5, injected: 0, failed: 0`, so its own injection had nothing to do. A `j` after the reload scrolled by the same distance as before the reload, in the tab that took the reload key and in a tab that did not. So the old script does not act a second time. This is one run with a temporary add-on. A signed add-on has not been checked.
- `browser.focus_page` works. With the address bar focused, the `<A-,>` chord ran it, and the next `j` scrolled the page.
- A chord that the content script cancels does not also fire the Firefox shortcut. On a page that cancels every key in its own capture listener, and on a normal page, `<A-j>` and `<A-k>` switched tabs exactly once. Tab counts cannot show which side ran the action. The count shows no double action.
- `<A-j>` and `<A-k>` also switch tabs from an `about:support` page, where no content script runs.
