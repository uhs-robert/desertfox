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

- `play()` with sound works in a frame from another origin. Firefox's autoplay rule reads the sticky activation of the top page, which any earlier key press there gives. In the test the harness's own probe key gives it before `ap`, so this case does not show that the `ap` press alone would.
- `requestPictureInPicture()` works on a video in the top frame, where the last key press is the `aP` the extension handles, so that key's transient activation outlasts the round trip through the background. In a frame from another origin it rejects with `NotAllowedError`: the activation stays in the frame that took the key. The command refuses with "This frame allows picture-in-picture only from a click in it".
- `requestPictureInPicture()` rejects with `InvalidStateError` on a `<video>` with sound and no picture.
- `tabs.executeScript` into a `sandbox` frame without `allow-scripts` rejects with "Missing host permission for the tab or frames". An `about:blank` frame takes the script with `matchAboutBlank`.
- In the nested test session the picture-in-picture window takes the keyboard focus. A desktop compositor may not.
- `"requestPictureInPicture" in HTMLVideoElement.prototype` is the feature check. Firefox 153 shipped the API on desktop. Before it, `aP` refuses with "Picture-in-picture needs Firefox 153 or newer". Not measured on a Firefox below 153.

Not measured: a `play()` the page blocks. The key press itself activates the top page, so the key test cannot make one. The command maps `NotAllowedError` from `play()` to "The page blocked play until you click it".

## Escape in fullscreen (media-hls-player)

Measured with a real Escape in the key test session (Firefox 160):

- Firefox handles Escape during DOM fullscreen itself. It exits the fullscreen and delivers no keydown to the page. A capture listener on the page that calls `preventDefault` on Escape sees nothing and does not stop it.
- The command line is a top-layer popover on the document element, so it shows over the fullscreen element. Its placement does not change the Escape handling.
- `browser.fullscreen.exit_on_escape` and `dom.keyboard_lock.enabled` do not exist in Firefox 160, and `navigator.keyboard` is undefined. Nothing found lets a page or an extension keep DOM fullscreen on Escape.
- So an Escape pressed on the line in media mode ends the fullscreen, not the line. The extension closes the line when the fullscreen ends and keeps the frame in media mode (`test/key/p29_media_mode.mjs`). The fullscreen itself ends.

## Frame focus and the tab's mode (google-docs-focus)

Measured in the key test (`test/key/p15_frame_mode.mjs`, Firefox 160) and on a public Google Doc in view mode, in headless Firefox 160.

- Google Docs types into a hidden frame of its own origin, made with `src="javascript:undefined"` and filled with `document.open`. The content script starts in the written document, after the `document.open`, and its listeners stay.
- A frame with no `src` gets its content script in the first `about:blank` document, at once when the frame is added. A `document.open` on that frame afterwards removes every listener the script put on the window, and Firefox does not inject the script again. The script still answers messages, but no key or focus event reaches it.
- A window's `focus` event fires on the top window when the tab is shown, also while a child frame holds the focus. It fires there too when focus comes back from a child frame, and when a focused child frame is removed. Inside the `focus` event `document.hasFocus()` is true, and inside `blur` it is false.
- A document whose child frame holds the focus still answers true to `document.hasFocus()`, and its `activeElement` is the frame element.
- `tabs.onUpdated` sends `{ status: "loading" }` with no `url` when a load starts. It sends `{ status: "loading", url }` when the new page takes over, and again for each `history.replaceState` the page runs while it still loads. The second kind comes after the content script's first message. Google Docs does this on every load.
- The page a load leaves keeps sending messages between the two events: its window gets a `focus` event when the load starts from the address bar.
- The Docs text frame's box is left 0, top -10000, 625 by 1 CSS pixels, with opacity 0. `window.frameElement` reads the same box from inside the frame.
- `frameElement.blur()` from the frame moves the focus to the top document in one tick. It also blurs the frame's focused field, and the frame's `activeElement` becomes its body. Focusing the frame element afterwards focuses the frame's window with no field. Focusing the field itself from the top document works.
- Docs does not take the focus back after that blur, on its own or on a key. A mouse press in the document, its grey margin or the outline focuses the field again within 30 ms.
- A page that focuses a field in a child frame fires `focus` on the frame's window first. Inside that event the frame's `activeElement` is not the field yet.
- When the focus moves from a field in a child frame to a field of the top document, the frame's field fires `focusout` first, with the frame's body as its `activeElement`. `frameElement.blur()` inside that event cancels the move: the top document's `activeElement` ends as its body.
- A window that loses the focus (a hidden tab) fires `blur` and `focusout` on its focused field, which stays the `activeElement`.
- `element instanceof HTMLElement` is false in a content script for an element of a same-origin child frame's document.

## The Google Sheets cell editor (sheets-cell-editor)

Measured on Google's public sample sheet in view mode, in headless Firefox 160, and in the key test (`test/key/p15_cell_editor.mjs`) on a stand-in page. Not measured on a sheet with edit rights.

- Sheets keeps one contenteditable focused in the top document from load on: `div#waffle-rich-text-editor.cell-input`, inside `div.input-box`.
- While a cell is only selected, the box sits at `top: -10000px` from the stylesheet, and the editor is empty with an `offsetWidth` of 0. Arrow keys move the selection and change none of this.
- Enter or F2 starts an edit. Sheets then sets `left`, `top` and `min-width` inline on the box, so the editor sits over the cell with the cell's width. The key that ends the edit clears the inline style and the text.
- No focus event fires at either end of an edit.
- Sheets cancels an edit on an Escape keydown that reaches its handler. Not measured on a sheet with edit rights: the shipped rows turn on `escape_to_page` on the assumption that it does, and the owner check on a real sheet confirms it.
- The class `editable` is no signal: Sheets adds it at the first edit and never removes it. In view mode `contenteditable` turns `false` at the first edit and stays so.

## Permissions (optional-permissions)

Read from the Firefox 160 sources (`omni.ja`), plus the key test for the grant and removal paths. The user-input fact is source-read, not measured in a run.

- `permissions.request` has `requireUserInput`. It rejects with "may only be called from a user input handler" unless the calling window handles user input: a trusted DOM event in that same window, or an event listener of `commands.onCommand`, `browserAction.onClicked`, `pageAction.onClicked` or `omnibox`.
- A key pressed on a page reaches the background through `runtime.sendMessage`, which carries no such flag. So the background cannot request a permission after a key. DesertFox refuses with a hint and asks from the click on an extension page instead (`:permissions.grant`).
- A declined request resolves `false` and does not throw. A policy block throws "Permissions are blocked by enterprise policy". An already granted permission resolves `true` with no prompt.
- A grant persists across restarts. The running background sees it at once (`permissions.contains` is true with no reload). The key test grants and removes with `ExtensionPermissions.add` and `remove`, passing the extension as the third argument so the background learns of the change.
- `browsingData` shows "Clear recent browsing history, cookies, and related data" at install. Moving it to `optional_permissions` removes that line.
- `cookies` shows no install prompt line, but it stays required. Without it Firefox 160 throws "No permission for cookieStoreId" in `tabs.create`, `windows.create` and `downloads.download` when they carry a container.

## Per-site zoom memory and `tabs.setZoom` (per-site-settings)

Measured in Firefox 160 in the key-test session with a throwaway piece: an extension background calling `tabs.setZoom`, `getZoom` and `getZoomSettings`, `FullZoom.enlarge` from chrome code, a real Ctrl+minus, and test hosts from `network.dns.localDomains`. `browser.zoom.siteSpecific` is true, the default.

- Firefox remembers one zoom level per host. Ports share it (`127.0.0.1:A` and `127.0.0.1:B`). Subdomains do not: `a.example.test`, `b.example.test` and `example.test` each keep their own.
- `tabs.setZoom` writes that memory, like a manual zoom does. A new tab on the host opens at the level, and so does the same tab after a reload or after it leaves the host and comes back. `setZoom(tab, 1)` stores 1. `setZoom(tab, 0)` resets to the default.
- A level set in one tab did not change another open background tab of the same host: its `getZoom` kept the old level.
- `getZoomSettings` reports `{ mode: "automatic", scope: "per-origin", defaultZoomFactor: 1 }`. `setZoomSettings` refuses `scope: "per-tab"` and `mode: "manual"` ("Unsupported zoom settings"), so an extension cannot keep its level out of the site's memory.
- A `setZoom` from `tabs.onUpdated` at the update that carries the new address (status `loading`) stays after the load completes. Firefox does not put the old level back.
- A new tab created with an address reports `{ status: "loading" }` with no `url` in the change, the address already on the tab. A navigation in an open tab reports the `url` change with `status: "loading"`. `pushState` and a hash change report the `url` change with `status: "complete"`.
- A private window starts from the normal memory, then keeps its own: a level set there did not reach a normal tab of the host, and a level set in a normal tab did not reach the private one. A second private tab of the host opened at the private level.

What it means for the `zoom` setting: setting the level writes Firefox's memory for the host, so DesertFox sets it only the first time a tab reaches the host in a browser session, keyed by host as Firefox keys it, with the private windows apart. A manual zoom after that sticks across reloads, pages of the site, new tabs and a round trip to another site. Because the memory is per host, a level for one path of a host acts on the whole host.

## content.js size (content-size)

Measured in Firefox 160 on Linux, headless unless stated, at main fd5825ff (content.js 16366 B minified). The scripts are in `tools/measure/`, see its README. These numbers back the guard and the ceiling in [design.md](design.md), "Content script size".

### How Firefox loads a manifest content script

Read from Firefox source, not measured.

- Compile starts at request time, before the document exists, and the script is injected at `initial-document-element-inserted`.
- The compiled script is cached per extension per content process for 5 minutes after its last use. Every frame and tab in that process shares it, and each frame's sandbox gets its own instance.
- A script of 5000 characters or more compiles off the main thread.
- Manifest scripts get a full parse, not a lazy one, so code that never runs still costs compile time and memory.
- No disk bytecode cache applies to content scripts.

### Cost of size

Compile and run, in the parent process with `ChromeUtils.compileScript` and `executeInGlobal` in a new sandbox. Median of 9. "eager" is synthetic code where every function runs. "lazy" is real content.js text in functions that never run.

| Script | Bytes | Compile ms (median, min) | Instantiate and run ms per sandbox |
|---|---|---|---|
| eager 4 KB | 4200 | 0.48, 0.20 | 0.10 |
| eager 8 KB | 8196 | 0.66, 0.41 | 0.13 |
| eager 16 KB | 16440 | 1.67, 0.83 | 0.22 |
| eager 32 KB | 32856 | 3.38, 2.44 | 0.26 |
| eager 64 KB | 65574 | 5.16, 2.60 | 0.63 |
| eager 128 KB | 131115 | 9.38, 6.72 | 1.80 |
| eager 256 KB | 262155 | 13.4, 11.2 | 2.11 |
| eager 1 MB | 1048629 | 56.4, 53.4 | 12.0 |
| lazy 16 KB | 16384 | 2.61, 1.35 | 0.12 |
| lazy 64 KB | 65536 | 4.46, 3.83 | 0.35 |
| lazy 256 KB | 262150 | 17.1, 14.5 | 1.09 |

Compile costs about 0.05 to 0.1 ms per KB, once per content process per 5 minutes, off the main thread. Instantiate and run costs about 0.01 ms per KB per frame.

Heap per sandbox, 300 live sandboxes each running the script (`micro.mjs`; `bench.mjs` runs the same with 200), after a forced GC (JS GC heap plus malloc heap):

| Script | Bytes per sandbox |
|---|---|
| empty | 3 to 8 KB |
| eager 4 KB | 11 KB |
| eager 16 KB | 40 to 42 KB |
| eager 32 KB | 80 KB |
| eager 64 KB | 148 KB |
| eager 256 KB | 644 KB |

That is about 2.4 bytes of heap per source byte, in every frame. A real frame's sandbox has a window prototype and Xray wrappers, so its fixed cost is higher than the empty row, and that part does not depend on script size.

Time to the key listener, with a probe add-on (`document_start`, `all_frames`, `<all_urls>`) on a local page, 25 reloads per size, from response start to the listener attached:

| Padding | Warm median ms, pass 1 | Warm median ms, pass 2 | First load after install ms, pass 1 / pass 2 |
|---|---|---|---|
| none | 4.7 | 5.6 | 61 / 11 |
| eager 4 KB | 5.1 | 17.3 | 8 / 6 |
| eager 16 KB | 54.5 | 7.4 | 39 / 5 |
| eager 32 KB | 5.2 | 5.7 | 13 / 11 |
| eager 64 KB | 11.8 | 5.7 | 45 / 7 |
| eager 256 KB | 9.8 | 7.5 | 100 / 14 |
| eager 1 MB | 29.0 | 12.3 | 591 / 57 |
| lazy 64 KB | 5.5 | 6.4 | 16 / 7 |
| lazy 256 KB | 8.0 | 6.8 | 46 / 19 |
| lazy 1 MB | 8.8 | 10.1 | 348 / 63 |

- Up to 64 KB the warm numbers sit at 5 to 7 ms. The run-to-run noise is larger than any size effect (the 54.5 and 17.3 outliers did not repeat in the other pass).
- A size effect shows from 256 KB (about 2 ms warm and a slower first load) and is clear at 1 MB.
- What delays the first key is not size: Firefox's document setup (the listener is ready 11 to 58 ms after the first byte, median 27) and the `read_keymap` round trip (median 9.5 to 10 ms, during which keys are held, not lost).

Limits: headless, one machine, one run of each table, and the end-to-end table is noisy. The compile and memory runs used the parent process and a bare sandbox, not a content process with a window.

### Heap in a heavy session

Heap at each size, from the 2.4 KB per KB figure.

| Session | Loaded tabs | Frames per tab | Frames | At 17 KB | At 32 KB | At 64 KB |
|---|---|---|---|---|---|---|
| Light | 10 | 3 | 30 | 1.2 MB | 2.3 MB | 4.6 MB |
| Typical | 20 | 5 | 100 | 4.1 MB | 7.7 MB | 15 MB |
| Heavy | 50 | 8 | 400 | 16 MB | 31 MB | 61 MB |

The tab and frame counts are estimates, not measurements. 1 KB of content.js costs about 1 MB in a heavy session and 0.25 MB in a typical one.

### Cost of a bundle on first use

Headed key test, real key presses, 4 fresh pages each.

| Key | First press | Second press | Bundle |
|---|---|---|---|
| `f` to hint labels in the DOM | 18 ms (16 to 42) | 7 ms (5 to 27) | hints.js, 40 KB |
| `g` to the which-key panel (includes the 100 ms test delay) | 127 ms (115 to 135) | 111 ms (106 to 115) | whichkey.js, 6.6 KB |

The background's injection call took 1 to 3 ms. A bundle costs 11 to 16 ms on its first use in a frame.

### Subframes

Extension heap in a content process, from Firefox memory reports, on pages with 200 subframes (two runs, same numbers).

| Page | Extension heap | Per frame | Messages to the background |
|---|---|---|---|
| No subframes | 0.8 to 1.0 MB | the top frame, with ui.js | 5 |
| 200 about:blank frames (before PR C, started at load) | 48.5 MB | about 240 KB | 403 `mode_changed`, 201 `read_keymap` |
| 200 same-origin frames (before PR C, started at load) | 54.6 MB | about 273 KB | the same |
| 200 about:blank frames (inert until focused) | 19.4 MB | about 97 KB | none at load |
| 200 same-origin frames (inert until focused) | 31.3 MB | about 156 KB | none at load |
| 200 sandboxed frames (inert, as a frame from another site) | 20.0 to 21.7 MB | about 100 KB | 5 |

Every subframe, same-origin or not, waits for its first focus before it starts the content script. A started frame costs about 140 KB more than an inert one, mostly the parsed keymap (the reply is 91,701 characters) and the mode and focus state. The frames are synthetic (200 empty frames). The resident-memory run (`frames.mjs`) had about 30 MB of noise on a 200 MB process and could not confirm the size.

### Work per key and at startup

Instrumented build, real key presses.

| Step | Time |
|---|---|
| `start()`: 9 listeners, mode wiring, the message listener, the keymap ask | 0.9 to 1.0 ms warm, 4.4 to 5.7 ms on the first pages of a run |
| `JSON.parse` of the keymap reply (91,701 characters) | 0.4 to 1.4 ms |
| `install_matcher` | 0.16 to 0.34 ms |
| keydown, unbound key | 0.2 ms median (0.10 to 0.42) |
| keydown, `j` (scroll) | 0.34 ms median (0.20 to 0.52) |
| keydown, Escape | 0.37 ms median |
| keydown, a letter typed in a field | 0.2 ms median |
| keyup | 0.02 ms |

### Switching to a discarded tab

Times in ms from the background's `tabs.update` call, median (min to max). Local server that answers in a few ms, a 12,000 px tall text page, 10 runs each.

| Step | Loaded tab | Discarded tab |
|---|---|---|
| `tabs.update` resolves | 4.9 (2.7 to 6.8) | 8.7 (7.7 to 13.3) |
| Navigation starts | not applicable | 7.4 (6.1 to 11.5) |
| First byte of the response | not applicable | 17.6 (16.5 to 25.5) |
| Content script starts, listener attached, `read_keymap` sent | already running | 45.7 (41.4 to 81.8) |
| Keys work (loaded: `mode_changed` from the new tab) | 9.8 (5.7 to 18.8) | 61.3 (55.3 to 96.9), keymap installed |
| First contentful paint | not measurable headless | 73.6 (53.7 to 107.0) |

- On a discarded tab no listener exists from 0 to about 46 ms, and a key pressed there is lost. From 46 to 61 ms key_flow holds every key and runs it when the keymap lands.
- The `read_keymap` wait was 16.1 ms (14.4 to 18.1) in the foreground and 10.4 (9.2 to 13.6) in a tab loaded in the background. The keymap lands before the first paint.
- `JSON.parse` of the compiled keymap (87,947 characters) takes 0.23 ms and the background's `storage.local.get` takes 1.7 ms. Most of the wait is message hops and main-thread contention.
- `tabs.reload` on a discarded tab loads it and leaves it inactive. The call returns in 5.3 ms, the content script starts at 59.7 ms (53.4 to 67.6) and has its keymap at 68.7 (62.4 to 80.2). A later switch costs 4.1 ms (3.4 to 4.6). `tabs.warmup` takes 4.6 ms in the background.
- Early j, in the headed key test with the body delayed 3 s and j pressed at 445 ms: 6 of 6 runs showed no scroll, the page saw no keydown, and a second j after the body arrived scrolled 50 px. A held scroll that finds no height is used up.
- On Linux, discarded tabs come from session restore (`browser.sessionstore.restore_on_demand`, default true) and explicit unloads. `browser.tabs.unloadOnLowMemory` is false on Linux.
