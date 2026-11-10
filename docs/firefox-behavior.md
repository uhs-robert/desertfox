# Measured Firefox behavior

This file records measurements of Firefox behavior that the design rests on.

## Phase 0

Phase 0 answered three questions before design work: where plain keys and Firefox shortcuts work, how soon a key listener is ready on a loading page, and what messages cost. The phase 0 test harness has been removed. It is in git history.

### Setup

- Firefox 159 with a throwaway profile, inside the Oasis shadow (a nested, invisible Hyprland). `wtype` sent real key presses.
- A temporary add-on, installed over Firefox's remote debugging protocol. It catches `Shift+J/K` in a `document_start` content script and has `Alt+J/K` as Firefox shortcuts.
- A local server serves pages with slow headers, a slow body, a page that cancels every key in its own capture listener, a long article for reader view and a PDF.
- A native host logs every event and echoes for the latency test.

### Results

| Page | `Shift+J` (content script) | `Alt+J` (Firefox shortcut) |
| --- | --- | --- |
| http page, about:blank | works | works |
| about:addons, about:preferences, about:support, about:license | lost | works |
| view-source, reader view, PDF viewer | lost | works |
| addons.mozilla.org | lost | works |
| New tab page, or address bar focused | lost | works |
| Page that cancels keys in its own capture listener | works | lost |

- The content script listener is ready 11-58 ms after the first byte of the response, with a median of 27 ms (24 fresh loads).
- While Firefox navigates away from a live page, the old page keeps catching keys until the new one commits. A new tab with no committed page catches nothing.
- After `J` switches to a tab that Firefox unloaded, a second `J` within about 120 ms is lost. At 200 ms it is caught. The test server answers in a few ms, so on a real site add the server's response time.
- Round trips from the content script to the background, and from the background to the native host over an open port, have a median under 1 ms and a p95 of 1 ms (300 samples each).

### What it means

- Plain `J/K` in a content script covers web pages, including pages that load and pages that cancel keys.
- `Alt+J/K` as Firefox shortcuts cover every page without a content script.
- The content script also catches the chords, so a page that cancels keys cannot block them where the content script runs.
- Firefox adds no startup delay of its own. A slow key listener comes from what the extension loads before it listens.

### Managed storage

A second test checked whether Firefox reads `~/.mozilla/managed-storage/<extension id>.json` again after an edit. The extension read `browser.storage.managed` every second.

- Edits made while the extension ran were not visible, 12 s later or ever. Firefox sent no `storage.onChanged` event.
- After the extension reloaded, it read the current file within about 1 s.
- So the file is read once per extension load. A reload applies an edit. A Firefox restart is not needed.
- This is why `config.reload` reads the files through the native host and does not restart the extension. Managed storage has since been removed. The extension starts on the defaults and takes the files from the first `config.reload`. A stale `~/.mozilla/managed-storage/desertfox@uhs-robert.json` is ignored and safe to delete.

## Phase 1 measurements

`just key-test` (`test/key/`) ran the built extension as a temporary add-on in the same kind of nested session, with the config directory handed to the native host through `DESERTFOX_CONFIG_DIR` and loaded after the install. Test pages report to a local server. Two measurements came out of that run, and two behaviors.

- The content script reads the compiled keymap from `storage.local` and sets `data-desertfox-tree-read-ms` on the document element. Over 24 fresh loads the read took a minimum of 6 ms, a median of 8 ms and a maximum of 10 ms, counted from the start of the content script. Firefox rounds these times to whole milliseconds. Since the background trims the tree for each page, the content script asks it with `read_keymap` instead. Sending the tree as an object cost a median of 20 ms, almost all of it the structured clone of the reply (about 11 ms), and the storage read in the background took about 2 ms. Sending it as a JSON string brought the median to 9.5 to 10 ms (two runs, maximum 15 and 20).
- After an extension reload (then `config.reload`, now `debug.restart`), Firefox loaded the content script again into every open `http` tab. The background stored `already_loaded: 5, injected: 0, failed: 0`, so its own injection had nothing to do. A `j` after the reload scrolled by the same distance as before the reload, in the tab that took the reload key and in a tab that did not. So the old script does not act a second time. This is one run with a temporary add-on. A signed add-on has not been checked.
- `browser.focus_page` works. With the address bar focused, the `<A-,>` chord ran it, and the next `j` scrolled the page.
- A chord that the content script cancels does not also fire the Firefox shortcut. On a page that cancels every key in its own capture listener, and on a normal page, `<A-j>` and `<A-k>` switched tabs exactly once. Tab counts cannot show which side ran the action. The count shows no double action.
- `<A-j>` and `<A-k>` also switch tabs from an `about:license` page (the key test) and from `about:support`, where no content script runs.

## Extension pages and `tabs.sendMessage` (0.1.1)

Question: does `tabs.sendMessage` reach a page of the extension itself, so the help page can run `content.js` as a plain script tag? Manifest `content_scripts` never match `moz-extension://` pages.

Setup: Firefox 159, temporary add-on, the nested session. A scratch build added `<script src="content.js">` to `home.html`, plus a probe script that reported `scrollY` to the background. The background opened the help page in a tab and sent messages to it. Real `j`, `G`, `gg` and `<S-Escape>` presses came from `wtype`.

Result: delivery works. No fallback is needed.

- `tabs.sendMessage(tab_id, { type: "ping" })` returned `true`, so `has_content_script` is right for the help page.
- `run_in_content` with `scroll.lines count=5` reached the page and scrolled it.
- `j` scrolled by 50 px, `G` reached the bottom and `gg` returned to 0.
- `mode_changed` arrived at the background with `sender.tab.id` set and `frameId` 0, for `normal` and then `ignore` after `<S-Escape>`. The stored per-tab mode followed.
- `repair_tabs_after_reload` skips the help tab, because its URL does not match `INJECTABLE_URL` (`https?|file|ftp`). It cannot throw or loop on it. After an extension reload Firefox closes extension pages, so there is nothing to repair.

## Caret drawing (P7a)

Question: does Firefox paint a caret for a collapsed selection in page text?

Setup: Firefox 159 headless, one page, a screenshot after a script set the selection with `Selection.addRange`.

Result: no. A collapsed range in plain text paints nothing. A one-character range paints as a highlighted block. So caret mode draws the caret as a one-character selection, which also makes `@selection` return that character. A caret on an empty line has no character and is not drawn.

## Smooth scrolling from a content script

Question: does `behavior: "smooth"` in `scrollBy` and `scrollTo` follow Firefox's own smooth-scrolling setting?

Setup: Firefox 159.0.1 in the key-test nested session, a content-script call of 600 px on a 6087 px page, sampled with `requestAnimationFrame` for 500 ms, with `general.smoothScroll` toggled at runtime.

Result: yes. With the pref true, `"smooth"` animated (about 30 distinct positions, not done at 500 ms). With the pref false, `"smooth"` jumped at once, even when the page CSS said `scroll-behavior: smooth`. `"instant"` always jumped. `"auto"` and an omitted behavior follow the page CSS. So DesertFox needs no smooth-scroll setting of its own. Firefox's default for the pref is true, and the key-test profile sets it false.

A single smooth scroll takes about 460 ms to finish. A held key lags with `"smooth"` on every keydown. Firefox starts each smooth scroll from the current animated position, so each repeat restarts the animation. At 25 repeats a second the page moved 235 px while instant scrolling moved 960 px, then drifted 33 px after release. So the page scroll keys use `"smooth"` on the first press and `"instant"` on repeats, and line scroll stays instant.

Smooth scrolls restart each other. Three `scrollBy` calls of 400 px in one tick with the pref true ended at 400 px, not 1200, and one call of 1200 px reached 1200. Two taps 50 ms apart ended at 472 px of 800, 150 ms apart at 667, 300 ms apart at 777 and 450 ms apart at 797. So a counted page scroll is one call for the whole distance.

## Firefox defaults (not measured)

These are Firefox defaults that the design relies on. Nobody has measured them in this project yet.

- When focus is in page content and not in a field, `/` starts Quick Find and `'` starts links-only Quick Find. DesertFox cancels both keys outside insert, ignore, hint and cmdline mode, see [Keys and modes](design.md#keys-and-modes).

## Iframe color-scheme and the first paint (issue 243)

Question: why did the command line show white frames on GitHub in dark mode?

Setup: Firefox 159 with the command line inside the extension's closed shadow root, at 1280x720, recorded at 60 fps. GitHub's real CSS and HTML served locally with `data-color-mode="auto"`, a dark preference, 16 opens per run.

Result: an iframe's `color-scheme: normal` resolves through the embedding page's `<meta name="color-scheme">`. GitHub declares `light dark`, so the iframe's used scheme was dark while cmdline.html, with no meta, was light. On that mismatch Firefox paints the frame's canvas opaque in the frame's own scheme, and the whole 80 px holder showed white until the frame reported `resize`. A CSS `color-scheme` on the page's root does not change what `normal` means, so such pages never flashed. A scheme set by script in the frame comes after the first paint and only cut the flashes. `light dark` on the iframe and in a meta in cmdline.html gave 0 white frames in 3 GitHub runs and 2 plain runs. The open came within 20 ms of the unfixed open.

`prefers-color-scheme` inside the frame follows the iframe's used scheme, and the DesertFox theme switches on that query. So `light` on both sides also stops the flash but shows the light theme in dark mode.

## Tab sessions: storage quota and discarded tabs (0.1.9)

Question: how much session data does `storage.local` take, and does `tabs.create` accept `discarded` with `pinned`?

Setup: Firefox 159.0.1 in the key test session, run from the extension's background page. A fixture of sessions with 50 tabs each (long address, title, container id and name).

Result:
- 100 sessions of 50 tabs are 1.29 MB of JSON. `storage.local.set` and `get` round-tripped it, and 400 such sessions (about 5 MB), with no `unlimitedStorage` permission. No quota showed up at these sizes. The key test fixture is smaller (no container fields), so the unit test only checks the order of magnitude.
- `tabs.create({ pinned: true, discarded: true })` rejects with "Pinned tabs cannot be created and discarded."
- `tabs.create({ discarded: true, title })` keeps the title and the tab stays discarded. `tabs.create({ pinned: true })` alone works.
- Creating the tab discarded and then `tabs.update(id, { pinned: true })` gives a pinned, still discarded tab that keeps its title.
- `tabs.create` rejects `about:config` and `file:///...` with "Illegal URL".

## DevTools Inspector handoff (devtools-inspect)

Question: can a hint pick select its element in the native Inspector, and where does focus go?

Setup: Firefox 159.0.1 in the key test session. A throwaway add-on with a `devtools_page`, a background relay keyed by tab id and a content script. The content script set `window.wrappedJSObject.__spike_pick` to the node. The devtools page ran `inspectedWindow.eval("inspect(window.__spike_pick)")`, then deleted the property. Toolbox state came from chrome code over the debugger.

Result:
- The node handoff works. `inspect()` selected the node in a plain page, an open shadow root, a closed shadow root (the content script reads it with `openOrClosedShadowRoot`), a same-origin iframe and an element under a transparent overlay. After the `delete`, the property was gone from the page.
- A cross-origin iframe gives no node: `contentDocument` is null. The only answer is a refusal.
- `inspect()` switches the toolbox from the Console tab to the Inspector. It does not open the split console, and it leaves an open split console open.
- After `inspect()`, keyboard focus is in the Inspector panel and the page reports `document.hasFocus() === false`. So the native Inspector keys work at once. This holds from the Console tab, the Inspector tab and with the split console open.
- Back to the page takes two keys: F6 then Escape, or F6 twice. Escape alone opens the split console. Ctrl+Shift+C leaves focus in the Inspector. Ctrl+Shift+I was not tried.
- `devtools.panels.elements.onSelectionChanged` fires once per `inspect()` call. Only Firefox 159 was run, so the 140 boundary is untested.
- Not measured: whether the Ctrl+Shift+C picker reaches an element under an overlay, in a closed shadow root or in an iframe. The key test cannot assert toolbox state either, so it checks the page property and the toast.

## browsingData hostnames (reload-clear)

Question: does `browsingData.remove({ hostnames })` clear one host's data, so a per-site clear needs no page script?

Setup: Firefox 160 in the key test session (the harness Firefox, not the 140 minimum). A local HTTP server answered with `cache-control: max-age=3600` and counted requests. Hosts were `127.0.0.1`, `localhost`, `sub.localhost` and `desertfox-probe.test`, which `network.dns.localDomains` resolved to the loopback server. localStorage was set in a tab on the host.

Result:
- `cookies` clear by `hostnames`, with a `cookieStoreId`.
- The cache is not cleared by `hostnames`: the call returns ok and the next fetch is still served from the cache, for every host above. `remove({}, { cache: true })` clears it.
- localStorage is not cleared by `hostnames`, with or without `cookieStoreId`: the call returns ok and the value survives, even after a reload.
- A `cookieStoreId` with `cache` rejects the whole call.
- Not measured: Firefox 140, a real public host name, `serviceWorkers` and `indexedDB` with `hostnames`.

Follow-up on `indexedDB` (Firefox 160, same setup):
- `browsingData.remove({ hostnames, cookieStoreId }, { indexedDB: true })` returns ok but clears nothing: a database with no open connection stayed too. So `hostnames` is ignored for IndexedDB as well, and it cannot stand in for the page's own delete.
- `indexedDB.deleteDatabase` from a page that holds a connection to the database fires `blocked`. The delete stays pending and finishes once the connection closes, which a reload does.
- So `rc` leaves a held database to that pending delete and names IndexedDB as stayed in its notice.

## tabs.saveAsPDF (page-group)

Checked by hand on Linux on 2026-11-10: `ps` saves a PDF, and replace and cancel in the file picker behave as Firefox's source says. `pr` opens the print window. The key test session cannot exercise either: `tabs.saveAsPDF` opens a GTK file picker that steals focus from the nested session and needs a person to answer. The call resolves to `saved`, `replaced`, `canceled`, `not_saved` or `not_replaced`. `ps` treats `canceled` as success and the two `not_` results as a refusal with a notice. `tabs.print` returns nothing, so `pr` has no result to check.

## Media keys across frames (media-group)

Measured in the key test (`test/key/p23_media_keys.mjs`, Firefox 160), with the key pressed in the top frame and the command routed through the background, which injects `media.js` into each frame and messages it:

- `play()` with sound works in a frame from another origin. Firefox's autoplay rule reads the sticky activation of the top page, and the key press gives it that.
- `requestPictureInPicture()` works on a video in the top frame, so the key's transient activation outlasts the round trip through the background. In a frame from another origin it rejects with `NotAllowedError`: the activation stays in the frame that took the key. The command refuses with "This frame allows picture-in-picture only from a click in it".
- `requestPictureInPicture()` rejects with `InvalidStateError` on a `<video>` with sound and no picture.
- `tabs.executeScript` into a `sandbox` frame without `allow-scripts` rejects with "Missing host permission for the tab or frames". An `about:blank` frame takes the script with `matchAboutBlank`.
- In the nested test session the picture-in-picture window takes the keyboard focus. A desktop compositor may not.
- `"requestPictureInPicture" in HTMLVideoElement.prototype` is the feature check. Firefox 153 shipped the API on desktop. Before it, `aP` refuses with "Picture-in-picture needs Firefox 153 or newer". Not measured on a Firefox below 153.

Not measured: a `play()` the page blocks. The key press itself activates the top page, so the key test cannot make one. The command maps `NotAllowedError` from `play()` to "The page blocked play until you click it".
