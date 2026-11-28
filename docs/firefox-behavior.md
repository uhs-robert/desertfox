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

### Working around the limits

- Keys in PDF files: let an external viewer open them. In Firefox Settings, under Applications, set Portable Document Format to "Use system default". The built-in PDF viewer catches no plain key (see the table above).
- A plain key such as `J` is lost when it lands on a tab that has not started loading. `Alt+j` and `Alt+k` switch tabs at once, because Firefox shortcuts need no content script, but they do not work on pages that cancel keys.

### Address bar keyword (omnibox)

Measured on Firefox 160 with the key test `test/key/p31_omnibox.mjs`, which types into the real address bar. The add-on registers the manifest keyword `df`.

- Typing `df tab.next` and Enter runs the command on `about:license`, where no content script and no plain key reach DesertFox. It also runs on an http page. The background receives `omnibox.onInputEntered` whatever the page shows. Adding the key needs no permission.
- With only a default suggestion set, the address bar shows one row, the default suggestion's text followed by the typed text: "Type a DesertFox command, for example tab.next df tab.next". The row is there as soon as the keyword and a space are typed, and it stays while the command is typed.
- Plain Enter arrives with the disposition `currentTab`. DesertFox changes `where` only for the other two dispositions.
- A refused line (`df rust`) runs nothing and the tab stays where it was.
- Suggestions from `onInputChanged` fill the rows below the default one. The address bar showed 10 rows in all, so nine suggestions fit beside the default row, and DesertFox sends at most nine. A user's `browser.urlbar.maxRichResults` can lower that.
- The description is plain text. Firefox 160 showed `<dim>` tags and `&lt;` entities literally, so DesertFox sends neither (the key test checks that a keys column such as `<A-p>` shows as written), although the API documentation says the markup works.
- The headless test cannot judge the look of the row, a clash with the user's own address bar keywords, or the private window case.

### Managed storage

A second test checked whether Firefox reads `~/.mozilla/managed-storage/<extension id>.json` again after an edit. The extension read `browser.storage.managed` every second.

- Edits made while the extension ran were not visible, 12 s later or ever. Firefox sent no `storage.onChanged` event.
- After the extension reloaded, it read the current file within about 1 s.
- So the file is read once per extension load. A reload applies an edit. A Firefox restart is not needed.
- This is why `config.reload` reads the files through the native host and does not restart the extension. Managed storage has since been removed. The extension starts on the defaults and takes the files from the first `config.reload`. A stale `~/.mozilla/managed-storage/desertfox@uhs-robert.json` is ignored and safe to delete.

## Phase 1 measurements

`just key-test` (`test/key/`) ran the built extension as a temporary add-on in the same kind of nested session, with the config directory handed to the native host through `DESERTFOX_CONFIG_DIR` and loaded after the install. Test pages report to a local server. Two measurements came out of that run, and two behaviors.

- The content script reads the compiled keymap from `storage.local` and, in the key-test build only, sets `data-desertfox-tree-read-ms` on the document element. Over 24 fresh loads the read took a minimum of 6 ms, a median of 8 ms and a maximum of 10 ms, counted from the start of the content script. Firefox rounds these times to whole milliseconds. Since the background trims the tree for each page, the content script asks it with `read_keymap` instead. Sending the tree as an object cost a median of 20 ms, almost all of it the structured clone of the reply (about 11 ms), and the storage read in the background took about 2 ms. Sending it as a JSON string brought the median to 9.5 to 10 ms (two runs, maximum 15 and 20).
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

## Keys on a young new tab page (first-key-race, #667)

Question: the key test's first `f` on a fresh new tab page drew no labels in about half the runs, and a second `f` worked. Is a key lost in DesertFox, or before the page gets it?

Setup: Firefox 160 in the key test session. `p0_newtab_widgets` alone, 7 runs, one `f` press after the ready attribute. A test-side listener logged every keydown that reached `content.js` (a wrapped `stopImmediatePropagation` for the keys it cancels, a capture listener after its own for the keys it passes). A capture listener in the browser window logged the keys Firefox got.

Result: Firefox drops the key between its window and the page.

- The test pressed `f` 107 to 380 ms after the page document started, because the page renders its cards in about 100 ms.
- 3 of 7 presses were lost, at 107 to 117 ms. 4 of 7 were kept, at 121 to 380 ms.
- The browser window got every press. The page got none of the lost ones, and they never arrived later (3 s).
- In every run the page had the focus, the address bar did not, the document was not replaced and the keymap was installed 14 to 49 ms after the document started.

DesertFox cannot catch a key that the page never gets. The key test now runs a key probe on the new tab page before its first key.

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

### Reduced motion

Question: does `behavior: "smooth"` still animate when the page asks for reduced motion?

Setup: Firefox 160 headless, a fresh profile with `general.smoothScroll` true and `ui.prefersReducedMotion` 0 or 1, a page script calling `scrollTo({ top: 600, behavior: "smooth" })` on a 6000 px page, sampled with `requestAnimationFrame` for 600 ms. `matchMedia("(prefers-reduced-motion: reduce)")` matched only with the pref at 1.

Result: yes, it still animates. Both runs gave 19 distinct positions and ended at 600. Firefox does not turn a script's smooth scroll into a jump under reduced motion. So the scroll keys check the media query themselves and use `"instant"`.

## Firefox defaults (not measured)

These are Firefox defaults that the design relies on. Nobody has measured them in this project yet.

- Events that a content script creates, such as the mouse and drag events of the grab keys (`;g`, `;G`), have `isTrusted` false. A page that checks `isTrusted` ignores them, so the drag does not work there. See [the grab keys](../src/content/grab/README.md).
- When focus is in page content and not in a field, `/` starts Quick Find and `'` starts links-only Quick Find. DesertFox cancels both keys outside insert, ignore, hint and cmdline mode, see [Keys and modes](design/keys.md#keys-and-modes).

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
- `devtools.panels.elements.onSelectionChanged` fires once per `inspect()` call. Only Firefox 159 was run, so the 153 minimum is untested.
- Not measured: whether the Ctrl+Shift+C picker reaches an element under an overlay, in a closed shadow root or in an iframe. The key test cannot assert toolbox state either, so it checks the page property and the toast.

## browsingData hostnames (reload-clear)

Question: does `browsingData.remove({ hostnames })` clear one host's data, so a per-site clear needs no page script?

Setup: Firefox 160 in the key test session (the harness Firefox, not the 153 minimum). A local HTTP server answered with `cache-control: max-age=3600` and counted requests. Hosts were `127.0.0.1`, `localhost`, `sub.localhost` and `desertfox-probe.test`, which `network.dns.localDomains` resolved to the loopback server. localStorage was set in a tab on the host.

Result:
- `cookies` clear by `hostnames`, with a `cookieStoreId`.
- The cache is not cleared by `hostnames`: the call returns ok and the next fetch is still served from the cache, for every host above. `remove({}, { cache: true })` clears it.
- localStorage is not cleared by `hostnames`, with or without `cookieStoreId`: the call returns ok and the value survives, even after a reload.
- A `cookieStoreId` with `cache` rejects the whole call.
- Not measured: Firefox 153, a real public host name, `serviceWorkers` and `indexedDB` with `hostnames`.

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
- Measured with `tools/measure/media_key.mjs` (headless Firefox 160, 20 frames, the video only in the extra frame): an `about:blank` frame and a `srcdoc` frame are listed by `webNavigation.getAllFrames`, take the injection and are reached by the key in about 16 ms. A `data:` frame holding the only large video is not reached: the key went to the small top video, so `media.js` does not run there (or the frame is not listed). Which of the two was not told apart.
- `webNavigation.getAllFrames` answered in about 1 ms on a page of 20 frames, one of them blocked by a 20 s busy loop (5 rounds, headless Firefox 160). The listing does not wait on a hung frame. The media key still cuts it off at 300 ms.
- In the nested test session the picture-in-picture window takes the keyboard focus. A desktop compositor may not.
- `"requestPictureInPicture" in HTMLVideoElement.prototype` is the feature check. Firefox 153 shipped the API on desktop. Before it, `aP` refuses with "Picture-in-picture needs Firefox 153 or newer". Not measured on a Firefox below 153.

Not measured: a `play()` the page blocks. The key press itself activates the top page, so the key test cannot make one. The command maps `NotAllowedError` from `play()` to "The page blocked play until you click it".

## Escape in fullscreen (media-hls-player)

Measured with a real Escape in the key test session (Firefox 160):

- Firefox handles Escape during DOM fullscreen itself. It exits the fullscreen and delivers no keydown to the page. A capture listener on the page that calls `preventDefault` on Escape sees nothing and does not stop it.
- The command line is a top-layer popover on the document element, so it shows over the fullscreen element. Its placement does not change the Escape handling.
- `browser.fullscreen.exit_on_escape` and `dom.keyboard_lock.enabled` do not exist in Firefox 160, and `navigator.keyboard` is undefined. Nothing found lets a page or an extension keep DOM fullscreen on Escape.
- So an Escape pressed on the line in media mode ends the fullscreen, not the line. The extension closes the line when the fullscreen ends and keeps the frame in media mode (`test/key/p29_media_mode.mjs`). The fullscreen itself ends.

## Fullscreen requests per key press (media-hls-player)

Measured with a real key press in the key test session (Firefox 160):

- One key press allows one fullscreen request. A second `requestFullscreen()` on an inner element, in the same task or later, is denied with `TypeError: Fullscreen request denied`. It worked only with `full-screen-api.allow-trusted-requests-only` off, which a user does not have.
- A click on the site's own fullscreen button inside the key press works, because the site's handler makes the one request.
- So when no site fullscreen button is found, `F` fullscreens the player box and stops. A fixed-height style on an element inside the box can leave the video short of full screen. The extension cannot step inward to fix it.

## Frame focus and the tab's mode (google-docs-focus)

Measured in the key test (`test/key/p15_frame_mode.mjs`, Firefox 160) and on a public Google Doc in view mode, in headless Firefox 160.

- Google Docs types into a hidden frame of its own origin, made with `src="javascript:undefined"` and filled with `document.open`. The content script starts in the written document, after the `document.open`, and its listeners stay.
- A frame with no `src` gets its content script in the first `about:blank` document, at once when the frame is added. A `document.open` on that frame afterwards removes every listener the script put on the window, and Firefox does not inject the script again. The script still answers messages, but no key or focus event reaches it.
- A window's `focus` event fires on the top window when the tab is shown, also while a child frame holds the focus. It fires there too when focus comes back from a child frame, and when a focused child frame is removed. Inside the `focus` event `document.hasFocus()` is true, and inside `blur` it is false.
- A document whose child frame holds the focus still answers true to `document.hasFocus()`, and its `activeElement` is the frame element.
- `webNavigation.getFrame` and `getAllFrames` give each frame a `documentId`. `tabs.sendMessage` with that `documentId` in its options reaches only that document: once another document has replaced it, the send fails with "Receiving end does not exist".
- `tabs.onUpdated` sends `{ status: "loading" }` with no `url` when a load starts. It sends `{ status: "loading", url }` when the new page takes over, and again for each `history.replaceState` the page runs while it still loads. The second kind comes after the content script's first message. Google Docs does this on every load.
- The page a load leaves keeps sending messages between the two events: its window gets a `focus` event when the load starts from the address bar.
- The Docs text frame's box is left 0, top -10000, 625 by 1 CSS pixels, with opacity 0. `window.frameElement` reads the same box from inside the frame.
- `frameElement.blur()` from the frame moves the focus to the top document in one tick. It also blurs the frame's focused field, and the frame's `activeElement` becomes its body. Focusing the frame element afterwards focuses the frame's window with no field. Focusing the field itself from the top document works.
- Docs does not take the focus back after that blur, on its own or on a key. A mouse press in the document, its grey margin or the outline focuses the field again within 30 ms.
- A page that focuses a field in a child frame fires `focus` on the frame's window first. Inside that event the frame's `activeElement` is not the field yet.
- In a child frame of another origin, `navigator.userActivation.hasBeenActive` is false at the frame's first `focus` event for a script focus on load (container or field) and for a Tab into the frame, and true for a real mouse press in it (measured over about 15, 6 and 6 samples, with no exception). So Tab and a load focus look the same from inside the frame. A frame focused on load gets `load`, then window `focus` (with `document.hasFocus()` true and the body as `activeElement`), then the focus of its element. A frame in a new tab does not always get that load focus.
- When the focus moves from a field in a child frame to a field of the top document, the frame's field fires `focusout` first, with the frame's body as its `activeElement`. `frameElement.blur()` inside that event cancels the move: the top document's `activeElement` ends as its body.
- A window that loses the focus (a hidden tab) fires `blur` and `focusout` on its focused field, which stays the `activeElement`.
- `element instanceof HTMLElement` is false in a content script for an element of a same-origin child frame's document.
- A focused child frame of another origin that gets `display: none` or `visibility: hidden` loses the focus: Firefox moves it to the top document, which gets a window `focus` event. A frame that gets `opacity: 0`, or a height of 0 with no border, keeps the focus and the keys. Measured in `test/key/p6_frames.mjs` (Firefox 160).
- A child frame of another origin can call `window.focus()` on itself from a message handler while an extension iframe in the top document holds the focus. The focus moves into the child and its keys work. Measured in `test/key/p6_frames.mjs`, where the command line of the top document hands the focus back.

## The Google Sheets cell editor (sheets-cell-editor)

Measured on Google's public sample sheet in view mode, in headless Firefox 160, and in the key test (`test/key/p15_cell_editor.mjs`) on a stand-in page. Not measured on a sheet with edit rights.

- Sheets keeps one contenteditable focused in the top document from load on: `div#waffle-rich-text-editor.cell-input`, inside `div.input-box`.
- While a cell is only selected, the box sits at `top: -10000px` from the stylesheet, and the editor is empty with an `offsetWidth` of 0. Arrow keys move the selection and change none of this.
- Enter or F2 starts an edit. Sheets then sets `left`, `top` and `min-width` inline on the box, so the editor sits over the cell with the cell's width. The key that ends the edit clears the inline style and the text.
- No focus event fires at either end of an edit.
- Sheets cancels an edit on an Escape keydown that reaches its handler. Not measured on a sheet with edit rights: the shipped rows turn on `escape_to_page` on the assumption that it does, and the maintainer's check on a real sheet confirms it.
- The shipped `sheets` rows read these facts as `editable_remove = ["#waffle-rich-text-editor"]` with `editable_remove_unsized`: the editor counts as a field only while it has width. The id stands for the site, because a rule on zero width alone would also catch the hidden field a web terminal types into.
- The class `editable` is no signal: Sheets adds it at the first edit and never removes it. In view mode `contenteditable` turns `false` at the first edit and stays so.

## Permissions (optional-permissions)

Read from the Firefox 160 sources (`omni.ja`), plus the key test for the grant and removal paths. The user-input fact is source-read, not measured in a run.

- `permissions.request` has `requireUserInput`. It rejects with "may only be called from a user input handler" unless the calling window handles user input: a trusted DOM event in that same window, or an event listener of `commands.onCommand`, `browserAction.onClicked`, `pageAction.onClicked` or `omnibox`.
- A key pressed on a page reaches the background through `runtime.sendMessage`, which carries no such flag. So the background cannot request a permission after a key. DesertFox refuses with a hint and asks from the click on an extension page instead (`:permissions.grant`).
- A declined request resolves `false` and does not throw. A policy block throws "Permissions are blocked by enterprise policy". An already granted permission resolves `true` with no prompt.
- A grant persists across restarts. The running background sees it at once (`permissions.contains` is true with no reload). The key test grants and removes with `ExtensionPermissions.add` and `remove`, passing the extension as the third argument so the background learns of the change.
- `browsingData` shows "Clear recent browsing history, cookies, and related data" at install. Moving it to `optional_permissions` removes that line.
- `webNavigation` (required, for the media keys' frame list) adds a line to the install prompt and makes Firefox ask again on the update that adds it. The line is not measured in a run. The media key needs it because `tabs.executeScript` with `allFrames` waits on a hung frame (measured: 1553 ms with one hung frame among 20), while `webNavigation.getAllFrames` lets the background ask each frame by `frameId` with its own deadline.
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

## Tab groups (native-tab-groups)

Measured in Firefox 160 in the key test (`test/key/p32_tab_groups.mjs`).

- `browser.tabGroups` is absent from the background page when the manifest lacks the `tabGroups` permission, so the permission is required.
- After `tgD` closed a two-tab group, the newest four `sessions.getRecentlyClosed()` entries were all plain tab entries (each had a `tab` object, none a `window` or group object). Firefox 160 shows no closed-group entry to the API, so `u` (`tab.undo_close`) restores one tab at a time and the group does not come back as one unit. The probe logs this from `test/key/p32_tab_groups.mjs`. It did not check whether the restored tab rejoins its old group.
- Not measured: whether the permission adds an install prompt line, whether the active tab of a collapsed group keeps the group open, and whether groups exist in private windows. These need a person.

## Split view (split-view)

Measured in Firefox 160 in the key test, with probe pieces that opened a split through chrome code (`gBrowser.addTabSplitView`, as the tab context menu does) and drove it through `browser.tabs`. The extension API cannot create or end a split. Firefox 153, the manifest minimum, was not run.

- `tabs.Tab.splitViewId` is -1 (`browser.tabs.SPLIT_VIEW_ID_NONE`) for a tab in no split view. The two tabs of a split share one positive id, and each new split gets a new id. The two tabs are adjacent in the strip. The selected tab of the pair is `active` and `highlighted`. The other is neither. `@types/firefox-webext-browser` lacks the field, so `src/split_view_types.d.ts` declares it.
- `tabs.update(other, { active: true })` makes the other tab the active one, keeps the split and moves keyboard focus to its page. The browser's focused element is the selected tab's `browser` before and after. `onActivated` fires.
- Creating a split fires `onUpdated` with `splitViewId` for both tabs.
- `tabs.remove` of either tab ends the split. The other tab stays with id -1 and becomes active. `tabs.update({ pinned: true })` on one tab ends it too (the pinned tab moves to the pinned area). `tabs.discard` of the non-selected tab keeps the split and marks that tab discarded. Discarding the selected tab does nothing, as for any active tab.
- `tabs.group` on one tab of a pair puts both in the group, and `tabs.ungroup` of one takes both out. The pair keeps its split id.
- `tabs.move` on one tab of a pair moves both and keeps their order, and the pair starts at the given index (clamped so both fit). It never ends the split, also when the place is not adjacent. This differs from the blog post that announced Firefox 150.
- `tabs.move` onto the partner's own place swaps the two tabs and keeps the split. There is no swap call in `browser.tabs`, so a swap is a move of one tab onto the other's place. Only the moved tab gets an `onMoved` event.
- So the pair cannot move one place right through its own tab: the first tab to the next place swaps. A move of the first tab to an earlier place, or two or more places right, moves the pair whole. A move of the tab after the pair to the pair's first place puts that tab in front of the pair and moves the pair one place right (key test `p35_split_view`).
- A tab outside the pair moved onto a place inside the pair lands on the far side of the pair from where it started: a tab before the pair lands after it, and a tab after the pair lands in front of it (key test `p35_split_view`). The pair stays whole.
- A whole-pair move sends `onMoved` for both tabs, one after the other, in an order that keeps the tab model's shifts right. A swap sends it for the moved tab only. After `tabs.remove` ends a split, the surviving tab gets `onUpdated` with `splitViewId` -1.
- Firefox places a new split's two tabs at the end of the strip. Not measured: private windows, a split inside a collapsed group, and Firefox 153 to 159.
- Session restore (`sessions.restore`, the tab sessions in `session_store.ts`) is not measured. The stored fields (address, title, pinned, active) carry no split id, and the extension cannot create a split, so a restore loses it.

### The pane calls in the browser module (panes)

Measured in Firefox 161.0 in the key test (`p55_panes`), through the pane keys, the extension's request and `browser_module/desertfox-panes.js`. The chrome source read is the 161.0 build. Firefox 153 to 160 were not run.

| Call | Firefox internal |
| --- | --- |
| The window | `Services.focus.activeWindow`, with `windowtype` `navigator:browser`. From the core's sandbox its `gBrowser`, `BrowserCommands` and `SidebarController` are reachable as from the window itself. |
| Split with a new tab | `BrowserCommands.addTabSplitView()`: a new `about:opentabs` tab split beside the selected tab, then selected. It returns silently for a tab that is pinned, hidden or already split, so the module checks those first. |
| Split with the next tab | `gBrowser.addTabSplitView([tab, next], { insertBefore: tab })` over `gBrowser.visibleTabs`. It returns the `<tab-split-view-wrapper>`, or null when no tab could join. |
| Unsplit, close both | `tab.splitview.unsplitTabs()` and `tab.splitview.close()`. Unsplit also closes an `about:opentabs` tab of the pair. |
| Resize | The splitter between the panes sizes the first panel only: its `width` attribute and inline width. The first panel is `document.getElementById(gBrowser.tabpanels.splitViewPanels[0])`, the area is `gBrowser.tabpanels.clientWidth`, and Firefox's own limit is the panel's computed `min-width` on either side. Then `splitview.resetRightPanelWidth()` and `tabpanels.updateSplitterAriaAttributes()`, as a drag does. |
| Focus the page, the other pane | `gBrowser.selectedBrowser.focus()`. Selecting the partner tab keeps the split and moves the focus to its page. |
| Focus the sidebar | Whatever shows, in this order. An open panel (`SidebarController.isOpen`): `SidebarController.browser.focus()`. Else, with `SidebarController.launcherVisible` and `gBrowser.tabContainer.verticalMode`, the strip: `tabContainer.ariaFocusedItem` set to the selected tab and `focus()` called on that tab (measured: the DOM focus lands in `#tabbrowser-tabs`, where the sidebar keys take `j` and `k`). Else, with the launcher visible, `SidebarController.sidebarMain.focusButtonGroup()`. Else `toggle(lastOpenedId ?? "viewBookmarksSidebar")`, because `toggle()` with no id opens the first panel in Firefox's table, History, when no panel was ever opened. |
| Focus DevTools | `DevToolsShim` from `chrome://devtools-startup/content/DevToolsShim.sys.mjs`: `isInitialized()` says whether DevTools loaded, so the call never loads it, then `getToolboxForTab(tab)`. `toolbox.hostType` is `bottom`, `left` or `right` when docked and `window` when detached. `toolbox.focusTool(toolbox.currentToolId)` focuses the current tool's frame. |
| Equal widths | The first panel's width set to half of the two panels' `getBoundingClientRect().width` together, written as for a resize, then `resetRightPanelWidth()`. |
| Focus left or right | The panes compare the left edges of `document.getElementById(tab.linkedPanel)`. DevTools counts when `toolbox.hostType` is that side. The sidebar counts only while it shows something (a panel, the strip or the launcher), and a move never opens it. The sidebar is on the left when `sidebar.position_start` differs from the window global `RTL_UI`, as `SidebarController` labels its own move button. |

- One `E>` widened the first panel by 5 percent of the panel area, within 2 px, and `E<` narrowed it back. A widen of 20 steps stopped the first panel at the area minus its `min-width`.
- After `ED` with the console docked at the bottom, the window's focused window was the toolbox's.
- `E=` after a widen made the two panels equal within 2 px. `E<Space><<<` narrowed the first panel three steps of 5 percent. `El` and `Eh` moved between the panes of a split.
- Not measured: the sidebar focus, DevTools docked left or right, and a split in a private window.

## Sidebar keys (sidebar-keys)

Measured in Firefox 161.0 in the key test, with a probe piece that opened each panel through `SidebarController.show(id)`, pressed real keys and logged keydown at the window root, the window (capture, bubble and the system group) and the panel's own window. The chrome source read is the 161.0 build. Firefox 153 to 160 were not run.

- Defaults: `sidebar.revamp` true, `sidebar.verticalTabs` false. The panel ids are `viewHistorySidebar`, `viewBookmarksSidebar`, `viewTabsSidebar` (synced tabs) and `viewOpenTabsSidebar`. The open tabs panel exists only with `sidebar.openTabsPanel.enabled` (default false). The bookmarks panel is the older places tree (`chrome://browser/content/places/bookmarksSidebar.xhtml`) unless `sidebar.updatedBookmarks.enabled` (default false). An add-on's panel loads `chrome://browser/content/webext-panels.xhtml`.
- The panel is an in-process chrome document in `<browser id="sidebar">` (not remote). The browser window's root and its capture listener see every key pressed in a panel, before the panel does. `event.target` is the panel's root element (`sidebar-history`, `sidebar-opentabs`, or the focused element in the places page), and `event.originalTarget` is the focused element itself, inside shadow roots too.
- `show()` puts the focus in the panel's search box: the `input` inside the `moz-input-search` shadow root. `document.activeElement` of the window is the sidebar `<browser>`, and `commandDispatcher.focusedElement` is that `input`. The window's `IMEStatus` is enabled there. A letter types into the box and nothing prevents it.
- In the revamped panels' search box ArrowDown does nothing, and Tab goes to the panel's menu button, not to the list. In the places page Tab goes to the tree (`tree#bookmarks-view`), whose arrow keys Firefox prevents (handled). Escape, `/` and the letters are not handled by any panel.
- The revamped panels' list is a tree view (`SidebarTreeView`). It reads `event.code` for ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home and End. A row (`sidebar-tab-row`) opens on Enter. An open tabs row holds its tab as `tabElement`, and its close button calls `gBrowser.removeTabs([tab])`.
- With vertical tabs on, `tabContainer.verticalMode` is true. A focused tab is the window's focused element, inside `#tabbrowser-tabs`. Plain ArrowDown there is handled by Firefox. Ctrl+ArrowDown moves the strip's keyboard focus (`ariaFocusedItem` over `ariaFocusableItems`, public). `gTabsPanel.showAllTabsPanel()` exists. Firefox's own strip listeners take only Ctrl, Ctrl+Shift, Enter and Space, so a letter reaches a window listener unhandled.
- `SidebarController.sidebarMain.focusButtonGroup()` puts the focus on a launcher button inside `sidebar-main`'s shadow root.
- Arrow keys, Home, End and Enter typed through `nsITextInputProcessor` after the key event (the browser module's `type_key`) reach the focused row and move, open and fold as real keys do (key test `p56_sidebar_keys`). A typed key passes the window root's listeners again, as a trusted keydown.
- `sidebar.leave` back to the page: `gBrowser.selectedBrowser.focus()` makes the selected `<browser>` the window's `activeElement`.

Not measured: the updated bookmarks panel, synced tabs, tab groups and a split view pair in the strip, a right-to-left window, and an add-on's panel with real keys.

## The Navigation API in a content script (jump-list)

Measured in Firefox 160 in the key test, with a throwaway piece that listened from the content script world (`executeScript`) on same-origin test pages.

- `navigation` exists in a content script, and its `navigate` event reaches a listener there with `navigationType`, `destination.url`, `destination.sameDocument` and `hashChange` readable.
- `navigate` fires for every navigation the page starts: a link click, a form submit, `location.href`, `location.reload()`, `history.pushState` and `replaceState` (`sameDocument` true), a hash change (`hashChange` true) and `history.back()`. It also fires for `tabs.goBack` (`traverse`).
- It did not fire for these navigations that the browser starts: an address typed in the address bar, F5, `tabs.reload` and `tabs.update` with a `url`. Only `pagehide` shows those. `tabs.goBack` above shows that a browser-started navigation can still fire it, so treat this list as measured cases, not a rule. So the page cannot classify its own leave, and the jump list judges leaves in the background (`src/background/jump_leave.ts`).
- A `pushState` the page's own script makes (an inline script, an `onclick` attribute) fires `navigate` for the content script's listener too (jump-gaps, Firefox 160). At that moment `scrollY` still reads the offset from before the change: a page that pushes and then scrolls in the same task reports the old offset. `history.back()` and `forward()` within the document fire it as `traverse` with `sameDocument` true, and a hash change set by `location.hash` as `push` with `hashChange` true.
- `currententrychange` follows `navigate` for every change that commits in the document, with its `navigationType`: `pushState`, a hash change, back and forward, and a link the page intercepts with `event.intercept()`, whose `navigate` reported `sameDocument` false (jump-gaps, Firefox 160). A `pushState` the page cancels with `preventDefault()` fires `navigateerror` and no `currententrychange`, keeps the address and does not throw.
- On the new page, `navigation.activation` names the way it arrived (`push`, `reload`, `traverse`) and, for a same-origin arrival, the page it came from, for browser-started navigations too.

## Firefox pages from outside (firefox-page-keys)

Question: how can a key open `about:preferences`, `about:config` and the other privileged pages, which `tabs.create` refuses with "Illegal URL"?

Setup: Firefox 160.0 in a nested headless labwc with a temporary profile, on Wayland, on X11 (Xwayland) and with `-no-remote`. A probe add-on called a probe native host. Firefox 153, the manifest minimum, was not run.

Results:
- `firefox --profile <the running profile> <url>` exits 0 within about a second. The running Firefox opens the URL as a new, selected tab in its most recent browser window, with no new window. Run from a native host as `/proc/<ppid>/exe`, it behaves the same.
- `-no-remote` does not turn off the remote server in Firefox 160, so the key test session drives the route end to end.
- The host gets no profile in its argv. Its parent is the Firefox main process, which holds `<profile>/.parentlock` open, and its environment carries `MOZ_CRASHREPORTER_EVENTS_DIRECTORY=<profile>/crashes/events`.
- These open from the command line: `about:preferences` (and any pane hash such as `#privacy`), `about:addons`, `about:downloads`, `about:config`, `about:profiles`, `about:support`, `about:debugging` (it becomes `#/setup`), `about:debugging#/runtime/this-firefox`, `about:logins`, `about:processes`, `about:memory`, `about:policies`, `about:crashes` and `about:protections`.
- The add-on shortcuts view and the add-on update check have no URL. `about:addons` picks its first view from `history.state` or the `extensions.ui.lastCategory` pref and never reads the hash: `about:addons#shortcuts` opened the discover view. Both are one gear-menu click from `about:addons`.
- No route without the host: `tabs.create`, `tabs.update` and `windows.create` refuse the URLs, and an extension page cannot navigate to them.
- Focus: on X11 the window with the new tab was the active window. On Wayland it was not measured, because headless labwc has no input. Hyprland grants a focus request only with `misc:focus_on_activate`.
- A private window: not measured. Firefox opens command-line URLs in a normal window.

## Cost of the `media_quality` rule on a page with no video (quality-rule-load)

Counted from the unit tests (`test/quality_load.test.ts`) against a fake background, not measured in Firefox. One hard load: an address change, the load finishing, then the about:blank pass 1 s later. Per frame, the counts are the same for a page of 5 frames and one of 200.

| Message or work, per frame | Before | After |
| --- | --- | --- |
| `quality.js` injections | 3 | 0 (the 3 probe injections remain, and a frame with a video loads the bundle once) |
| `quality_report` messages | 3 | 0 (a frame with a video sends 1, from the bundle) |
| `quality_rule` messages | 3 | 0 (the message is gone) |
| `read_media_quality` messages | 11 | 0 (the message is gone) |
| Keymap reads in the background | 11 | 0 |
| Driver probes | 100 | 0 |
| Timers that wait | one poll for 10 s | one 2 s look-again timer for 10 s |

The off check reads the keymap once per trigger, about 3 reads per hard load for the whole tab, not per frame. With the rule `off` or `auto` everywhere (the global value `off` or the default `auto`, no site row asks for a quality) the count is 0 injections. A frame with a video costs one keymap read per load. Each report that comes from a frame with a video carries the rule in its answer. The 200-frame page that cost about 2,200 `read_media_quality` messages in 10 s now costs none.

## Manifest CSP on the extension pages (sec-css-attrs)

Measured in the key-test Firefox with the policy `script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https: http: resource: moz-icon:; connect-src 'self' https: http: data: blob:; worker-src 'self'`.

- The new tab font (`DSEG7 Classic`, a packaged file) loads. A tab's `favIconUrl` came back as a `data:` address, which loads, and a favicon over `http:` loads. A container icon (`resource://usercontext-content/briefcase.svg`) loads.
- The image copy fetch in the background page works for an `http:` image and a `data:` PNG.
- The policy is in force on an extension page: a remote script, an `@import` and a remote `@font-face` each raised a `securitypolicyviolation` (`script-src-elem`, `style-src-elem`, `font-src`). A remote `url()` image raised none, because `img-src` allowed `https:` and `http:`.
- Tab favicon lengths as Firefox 160 hands them to an extension, all `data:` URLs (characters): google 1874, github 1306, youtube 1689, wikipedia 3401, facebook 3721, reddit 23682. The command line list cap is 32768. A fresh scratch profile with network also gave `data:` favicons for tabs restored by session restore (discarded) and after selecting them (google 1874, github 1306, reddit 23682, a DesertFox page 1022). `about:support`, `about:preferences` and `about:addons` gave `chrome:` icons.
- Not measured: `img-src` after it dropped `https:` and `http:` (a remote `url()` image should now be blocked), and a `moz-icon:` address.
- The CSP covers extension pages only. A surface that DesertFox draws inside a web page falls under the page's own CSP, so the user CSS check in `build_files_config` is the guard there.

## Locked pages (locked-page-modes)

Question: can DesertFox's own `content.js` and bundles run inside the pages an extension cannot reach (about:addons, about:preferences, the PDF viewer, Reader View), and what does the message channel to the background need to carry?

Setup: Firefox 161.0, a private copy with a temporary profile, and the key-test build. Chrome code sent through the remote debugging protocol stood in for the browser module: a global frame script made the sandbox as Firefox makes a content script sandbox (the page window as prototype, Xrays, the extension id in the sandbox metadata), fetched `content.js` and the bundles from the extension's address and ran them there. A hidden extension page relayed messages to the background, so the round trips below are a lower bound for the `storage.session` channel.

Principals, read from inside the sandbox and checked from the page:

| Principal | about:addons, about:preferences | PDF viewer, Reader View |
| --- | --- | --- |
| The page's own (system on the about: pages) | reads and writes the DOM | reads and writes the DOM |
| Expanded `[page]` | refused: a system principal cannot be part of an expanded one | works, closed shadow roots unreadable |
| Expanded `[page, extension]`, as for content scripts | refused (same) | works, reads closed shadow roots |
| Content principal of the page address, null principal | no access | no access |

Results:
- The PDF viewer and Reader View work under the expanded `[page, extension]` principal. The two about: pages work only under the system principal. So `browser_module_pages` runs DesertFox's page code on the PDF viewer and Reader View only, and the background refuses a page call from any other about: page. The rows below keep what the spike measured on all four.
- On the PDF viewer and Reader View a page script sees nothing of the sandbox. On the two about: pages the sandbox shares the page's principal, so the globals `content.js` sets on `window` (`desertfox_host` and the load flags) show to the page's own scripts. `browser` and the transport stay on the sandbox global and do not show.
- `content.js` loads on all four, and the keydown listener counts for the module's liveness check. `f` draws labels on all four (21 to 23 on the toolbars and lists, about 105 ms from key to labels, as on a web page), and a pick clicks. Adopted stylesheets work. `v`, `e`, `y` copies text. Item mode works on the about:addons list.
- The command line iframe (`cmdline.html`) loads on the PDF viewer and Reader View. On the two about: pages the frame stays `about:blank`.
- A round trip of `read_keymap` (20 runs): median 4.6 ms on about:addons, 12.7 ms on about:preferences (one run of 55.5 ms), 5 ms on the PDF viewer and 6 ms on Reader View. Making the sandbox and loading `content.js` took 5 to 48 ms.
- Firefox will not inject the real content script there. Widening the policy's allowed origins makes `canAccessURI` true on all four, but no content script appears: the check runs in the content process on the document principal.
- The pages that run in the parent process (the two about: pages) refuse a `data:` frame script and a script name that is not a file, resource or chrome address. Content process pages refuse a `file:` frame script.
- A sandbox left on a page that went away kept a content process at 95% CPU and 1.6 GB. Nuking it on `pagehide` stopped that (4% CPU, 174 MB). On the about: pages one sandbox realm stayed in the parent after navigation and tab close, without growing over three attaches.
- A cross-process navigation starts a new frame script instance, so a rule kept per browser element stops after the first navigation. Process-wide state keeps it.
- The bundles call `storage.onChanged` (`src/shared/storage_watch.ts`). Without it the first `f` fails.

Message sizes, as JSON text with the default config:

| Message | Request bytes | Answer bytes |
| --- | --- | --- |
| `read_keymap` | 52 | 305,397 |
| `list_keys`, normal mode, no prefix | 66 | 20,420 |
| `list_keys`, prefix `g` | 69 | 3,645 |
| `storage.local.get` of the config status | 60 | 1,855 |
| `storage.local.get` of the theme | 50 | 1,206 |
| pushes in a hint and which-key session | | 15 to 90 each |

`hint_frames_start` carries the text of every candidate (about 30 characters each), and the register and editor messages carry free text. So the keymap, the config status, the theme and the root which-key list travel as snapshots, one `storage.session` key each with its own cap (`SNAPSHOT_PARTS` in `src/shared/browser_module_protocol.ts`), and each message kind has a size limit of at most 64 KB.

Facts from the built feature (Firefox 161, key piece `test/key/p54_browser_module_page_code.mjs`):
- The PDF viewer reports a second `status: loading` to `tabs.onUpdated` about 120 ms after the load, for the same document. The page code sees no pagehide and no second attach. So a `loading` event for the same address does not end a page code attach. Chrome's `page_gone` does. Reader View has no such event. The key piece presses `f` 1.5 s after the PDF loads, past that event.
- Item mode (`I`) finds no list on these two pages. That is the item finder's rule, not a fault of the sandbox: it gives no list under much prose and skips narrow items (see `src/content/item/finder.ts`). The PDF viewer's sidebar starts closed and its text layer holds no links. The key piece has no item case on these pages.
- The principal results above hold for the built feature: the page code runs under `[page, extension]` on the PDF viewer and Reader View, and a page script sees none of `desertfox_host`, the transport or `browser` there.

Not measured: the real `storage.session` channel, a dark theme, scanned, large or form PDFs, real Reader View articles, and an IME.

## Processes of Firefox's own pages (locked-page-hints)

Firefox 161, the key-test copy, read from each tab's `<browser>` (key piece `test/key/p55_page_hints.mjs`):
- In the parent process (`isRemoteBrowser` false, no `remoteType`): about:preferences, about:settings, about:addons, about:downloads, about:config and about:support. Chrome code reads their DOM directly.
- In a content process (`remoteType` `privilegedabout`): about:protections, about:logins and about:newtab. Chrome code cannot read their DOM, so hints there would need a collector in a frame script.

## Restricted hosts (restricted-domain-hints)

Firefox 161, the key-test copy, offline (key piece `test/key/p55_content_hints.mjs`, a test host added to `extensions.webextensions.restrictedDomains` and pointed at a local server with `network.dns.localDomains`):
- `network.dns.localDomains` resolves the test host to the local server with no restart.
- A host added to `extensions.webextensions.restrictedDomains` at run time counts at once: `WebExtensionPolicy.isRestrictedURI` matches it on http, and DesertFox's content script does not run on a page loaded after the change.
- The pref reads the same in the content process, and the module's `data:` frame script runs in the web content process of that page.
- The parent's `preventDefault` on a keydown in the browser window keeps the key from the remote page: the page saw no Enter that confirmed a mark.
- Read from the default prefs, not measured: `browser.tabs.remote.separatedMozillaDomains` lists addons.mozilla.org and accounts.firefox.com, and `browser.tabs.remote.separatePrivilegedMozillaWebContentProcess` is true, so those hosts load in the `privilegedmozilla` process.

## Keys in DevTools (devtools-keys)

Question: can chrome code give the DevTools trees j, k, h and l, docked and in a DevTools window, and which keys does DevTools already use?

Setup: Firefox 161.0, a private copy with a temporary profile, real key presses from the key-test session, and a probe module in its drop-in folder.

Results:
- Docked DevTools is a `<browser class="devtools-toolbox-iframe">` in the tab's browser container. The toolbox (`about:devtools-toolbox`) and every panel document (`chrome://devtools/content/...`) run in the parent process with the system principal. A capture keydown listener on the browser window sees every key typed in any panel, with the panel's element as the target.
- A key is in docked DevTools when the walk up from its document meets that class. `frameElement` stops at the toolbox `<browser>`, so the walk takes the browsing context's `embedderElement` there. About five steps, synchronous.
- A DevTools window (`hostType: "window"`) is its own top-level window of type `devtools:toolbox`. A listener on the browser window never sees its keys, so the module attaches to it on `domwindowopened` after its document loads.
- A `KeyboardEvent("keydown")` with the arrow's `key` and `keyCode`, made by chrome code and dispatched on the focused element, moves, expands and collapses the Inspector markup, the Debugger sources tree and the Storage tree, and moves the Network request rows, as the real arrows do. Gecko marks it trusted, because its maker has the system principal, so key listeners in chrome see it as a real arrow. With a DevTools context menu open, it moves the menu. `nsITextInputProcessor` fails from this context with `NS_ERROR_NOT_INITIALIZED`.
- DevTools keys that meet DesertFox's: Escape toggles the split console, and `h` hides the node in the markup view. Plain `j`, `k` and `l` do nothing in the markup view, the Debugger tree, Storage and Network. The console input takes every key.
- The Browser Toolbox runs in a second Firefox process with its own profile and no DesertFox.

## Hints in DevTools (devtools-keys)

Question: can chrome code draw hint labels in DevTools documents, and which events pick a tool tab and a markup line?

Setup: Firefox 161, a private copy with a temporary profile in the key-test session, docked DevTools on a data: page, then a DevTools window. Each probe added a closed shadow root to the toolbox and to the Inspector, markup, Console, Debugger, Network and Storage documents.

Results:
- A `<link>` to the extension's `chrome_hints.css` (a `moz-extension:` address) loads in every one of those documents, with its rules, despite their CSP.
- An inline `<style>` applies in the Inspector, markup, Console, Debugger and Network documents (`style-src chrome: 'unsafe-inline'`), and is ignored in the toolbox and Storage documents, whose CSP has `default-src chrome:` and no `style-src`. A constructed sheet in `adoptedStyleSheets` applies in all of them.
- The labels in a docked toolbox showed in a screenshot taken 700 ms after they were in the documents, and not in one taken at once.
- A tool tab (`.devtools-tab`) selects its tool on mousedown: `element.click()` does nothing. A `mousedown`, `mouseup`, `click` sequence made by chrome code selects it. The same sequence on a markup `.tag-line` selects its node, and the markup view keeps the keyboard focus, so j then moves on from it.

## Visual mode in DevTools (devtools-keys)

Question: can chrome code select and copy text in DevTools panels with keys, and where does the focus sit when it starts?

Setup: Firefox 161, a private copy with a temporary profile in the key-test session, docked DevTools and a DevTools window, the module's visual mode driven by real key presses.

Results:
- `Selection.modify("extend", ...)` by character, word and line boundary selects text in the console output, the rule view and the Network headers, and `nsIClipboardHelper.copyString` copies it. A line move in the rule view leaves it for the box model and the toolbar unless held in. The console draws only the messages near the view (52 of 301 in a probe), so a line move from the first message jumped to message 251. In the markup view it stops at the edge of each span of a tag line: from the `<` no move goes into the tag name's span, while inside the tag name character and word moves work. The computed view's text is `user-select: none` and selects nothing.
- In the Debugger source and the Network response (CodeMirror 6), `Selection.modify` loses the lines CodeMirror has not drawn, and CodeMirror rewrites the DOM selection a moment later. Shift+arrow keydowns made by chrome code on `.cm-content` move CodeMirror's own selection and scroll the editor, and `docShell.doCommand("cmd_copy")` copies all of it (121 lines in a probe). The `.cm-content` of the Debugger has `contenteditable="true"` though the editor is read-only.
- A click in the console output gives the focus to the console input. The output takes no focus, so a focus call on it leaves the focus where it was. A `blur()` of the input leaves the focus on the console document's body, and keys then reach that document.
- A click on a rule in the rule view opens an inline editor (an `input`). Its first focusable element takes the focus without an editor.
- The markup view keeps the focus on its document's body. The selected line is the `.tag-line` with `aria-selected="true"`.
- After a case that showed a source in the Debugger, the test page of the next case never took the focus, so that case runs last in its piece.
- Storage values were not reached: the Storage panel showed no rows for two localStorage items the page had set (`localStorage.length` 2), so whether its table cells and sidebar select is unknown, and the mode has no Storage row.
